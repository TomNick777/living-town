"""Life Energy CLI — the ledger's operator interface.

The portfolio is a standalone synthetic site. Explicit local mode and the
SVG workbench consume this CLI's localhost world service. Mutations,
classification and reconciliation remain operator actions.
"""

from __future__ import annotations

import argparse
import json
import sys

from .. import __version__
from ..accounts import service as accounts_service
from ..classification import review
from ..classification.engine import classify_transactions, override_category
from ..classification.seed import seed_all
from ..db.connection import default_db_path, open_db
from ..db.migrations import current_version, discover_migrations
from ..evidence_bridge import EvidenceBridge
from ..energy.display import type_label
from ..energy.interpret import override_energy_type, refresh_energy_interpretations
from ..energy.model import summarize_period
from ..ingestion import ParseResult
from ..ingestion.alipay import AlipayParser
from ..ingestion.bank import BANK_PARSERS, get_bank_parser
from ..ingestion.bank import bocom, boc, cib, icbc, cmb, ccb, gf_credit, gf_debit  # noqa: F401  (register the real-bank adapters)
from ..ingestion.bank.generic_csv import GenericCSVBankParser  # noqa: F401  (registers the adapter)
from ..ingestion.wechat import WechatParser
from ..ledger.importer import import_file
from ..ledger.queries import counts, get_transaction, list_transactions, month_bounds, unresolved_transactions
from ..living_town import PROJECTION_VERSION, build_town_state
from ..living_town import service as town_service
from ..reconciliation.refund_pairing import (
    confirm_refund_link,
    link_refund,
    list_refund_links,
    mark_all_unresolved,
    suggest_refunds,
    unlink_refund,
)
from ..reconciliation.transfer_pairing import (
    confirm_pair,
    create_pair,
    find_transfer_candidates,
    list_pairs,
    suggest_transfers,
    unpair,
)

# ------------------------------------------------------------------ helpers


def _fmt_minor(amount_minor: int) -> str:
    sign = "-" if amount_minor < 0 else ""
    return f"{sign}¥{abs(amount_minor) // 100}.{abs(amount_minor) % 100:02d}"


def _parser_for(channel: str):
    if channel == "wechat":
        return WechatParser()
    if channel == "alipay":
        return AlipayParser()
    if channel.startswith("bank"):
        return get_bank_parser(channel if ":" in channel else "bank:generic_csv")
    raise SystemExit(f"unknown channel {channel!r}; expected wechat | alipay | bank[:adapter]")


def _tx_line(tx: dict) -> str:
    account = tx.get("account_name") or "未归属"
    category = tx.get("category_code") or "未分类"
    energy = tx.get("energy_type") or "-"
    return (
        f"#{tx['transaction_id']:<5} {tx['occurred_at'][:16]}  {tx['source']:<9} "
        f"{tx['transaction_type']:<10} {tx['direction']:<7} {_fmt_minor(tx['amount_minor']):>10}  "
        f"{account} | {category} | {energy} | {(tx.get('counterparty') or tx.get('description') or '')[:24]}"
    )


# ------------------------------------------------------------------ commands


def cmd_db_status(args) -> int:
    with open_db(args.db) as conn:
        migrations = discover_migrations()
        applied = conn.execute("SELECT version, name, applied_at FROM schema_migrations ORDER BY version").fetchall()
        print(f"database: {args.db}")
        print(f"schema version: {current_version(conn)} (latest available: {migrations[-1].version})")
        print("applied migrations:")
        for row in applied:
            print(f"  {row['version']:>4}  {row['name']:<18} {row['applied_at']}")
        print("counts:", json.dumps(counts(conn), ensure_ascii=False))
    return 0


def cmd_import(args) -> int:
    parser = _parser_for(args.channel)
    with open_db(args.db) as conn:
        seed_all(conn)
        fallback_account_id = None
        if args.account:
            fallback_account_id = accounts_service.ensure_account(conn, args.account)
        report = import_file(conn, parser, args.file, fallback_account_id=fallback_account_id)
        print(f"source: {report.source_type}  file: {report.source_filename}")
        print(report.summary())
        for error in report.errors:
            print(f"  parse note: {error}", file=sys.stderr)
        _notify_evidence(conn, args.file, report, parser)
    return 0


def _notify_evidence(conn, file_path: str, report, parser) -> None:
    """Best-effort registration with Otter Evidence; the ledger never blocks on it."""
    if report.already_imported:
        row = conn.execute(
            "SELECT parser_version FROM import_batches WHERE batch_id = ?", (report.batch_id,)
        ).fetchone()
        parser_version = row["parser_version"] if row else None
    else:
        parser_version = parser.parser_version
    try:
        outcome = EvidenceBridge().notify_import(file_path, report, parser_version=parser_version)
    except Exception as exc:  # bridge bug must never turn into a ledger failure
        print(f"evidence: bridge error ignored ({exc.__class__.__name__})", file=sys.stderr)
        return
    print(f"evidence: {outcome.detail}")
    if not outcome.contacted:
        print(f"  (service: {EvidenceBridge().base_url}; set EVIDENCE_API_URL or start otter-evidence api)",
              file=sys.stderr)


def cmd_evidence(args) -> int:
    """Evidence registration status of every import batch (read-only; service optional)."""
    bridge = EvidenceBridge()
    with open_db(args.db) as conn:
        batches = conn.execute(
            "SELECT batch_id, source_type, source_filename, source_sha256, imported_at "
            "FROM import_batches ORDER BY imported_at, batch_id"
        ).fetchall()
    print(f"evidence service: {bridge.base_url}")
    print(f"ledger batches: {len(batches)}")
    reachable = True
    registered = extracted = 0
    for b in batches:
        state, locations, ref = "—", 0, ""
        reg = "—"
        if reachable:
            try:
                code, ev = bridge.get_evidence(b["source_sha256"])
                if code == 200:
                    reg = "registered"
                    registered += 1
                    locations = len(ev.get("locations") or [])
                elif code != 404:
                    reg = f"http {code}"
                code2, ex = bridge.get_extraction(b["source_sha256"], f"living-town:{b['source_type']}")
                extraction = ex.get("extraction") or {}
                state = str(extraction.get("state") or "—")
                ref = str(extraction.get("resultRef") or "")
                if state == "EXTRACTED":
                    extracted += 1
            except Exception as exc:
                reachable = False
                print(f"! service unreachable ({exc.__class__.__name__}) — ledger-only view below", file=sys.stderr)
        print(f"{b['source_sha256'][:12]}  {b['source_type']:<16} {(b['source_filename'] or '')[:42]:<42} "
              f"{reg:<12} {state:<12} locations={locations}  {ref}")
    if reachable:
        print(f"-- {registered} registered, {extracted} extracted of {len(batches)} batch(es)")
    else:
        print(f"-- service down: registration status unknown for {len(batches)} batch(es); "
              f"ledger itself is unaffected")
    return 0


def cmd_accounts(args) -> int:
    with open_db(args.db) as conn:
        if args.action == "add":
            account_id = accounts_service.ensure_account(
                conn, args.name, args.type, args.institution, args.masked_number
            )
            conn.commit()
            print(f"account #{account_id}: {args.name} ({args.type})")
        elif args.action == "alias":
            account = conn.execute("SELECT account_id FROM accounts WHERE name = ?", (args.account_name,)).fetchone()
            if account is None:
                raise SystemExit(f"unknown account {args.account_name!r}; add it first")
            accounts_service.add_alias(conn, args.channel, args.value, account["account_id"], args.prefix and "PREFIX" or "EXACT")
            conn.commit()
            print(f"alias {args.channel}:{args.value} -> {args.account_name}")
        elif args.action == "list":
            for account in accounts_service.list_accounts(conn):
                print(f"#{account['account_id']:<3} {account['name']:<24} {account['account_type']:<10} {account.get('institution') or ''}")
            for alias in accounts_service.list_aliases(conn):
                print(f"      alias {alias['channel']}:{alias['alias_value']} ({alias['match_mode']}) -> {alias['account_name']}")
        elif args.action == "reattribute":
            stats = accounts_service.reattribute_transactions(conn, args.channel)
            print(
                f"attribution re-run: {stats['updated']} updated, {stats['unchanged']} unchanged, "
                f"{stats['unresolvable']} still unresolvable (no alias match; NULL is kept)"
            )
    return 0


def cmd_transactions(args) -> int:
    with open_db(args.db) as conn:
        if args.action == "list":
            rows = list_transactions(conn, month=args.month, transaction_type=args.type, limit=args.limit)
            for tx in rows:
                print(_tx_line(tx))
            print(f"-- {len(rows)} transaction(s)")
        elif args.action == "show":
            tx = get_transaction(conn, args.transaction_id)
            if tx is None:
                raise SystemExit(f"transaction {args.transaction_id} not found")
            print(json.dumps(tx, ensure_ascii=False, indent=2, default=str))
        elif args.action == "unresolved":
            groups = unresolved_transactions(conn)
            titles = {
                "unknown_type": "UNKNOWN transaction type (needs evidence, not guessing)",
                "unattributed_account": "unattributed source account (add aliases)",
                "unclassified": "unclassified EXPENSE/INCOME (add rules or override)",
                "unpaired_transfer": "transfers without a pair (bank statement may be missing)",
                "unresolved_refund": "refunds without an original transaction",
            }
            total = 0
            for key, rows in groups.items():
                print(f"\n== {titles[key]}: {len(rows)}")
                for tx in rows[: args.limit]:
                    print("  " + _tx_line(tx))
                total += len(rows)
            print(f"\n-- {total} unresolved item(s) overall; these are honest gaps, not errors")
        elif args.action == "override":
            override_category(conn, args.transaction_id, args.category, note=args.note)
            refresh_energy_interpretations(conn)
            print(f"transaction #{args.transaction_id} -> category {args.category} (manual override)")
    return 0


def cmd_transfers(args) -> int:
    with open_db(args.db) as conn:
        if args.action == "candidates":
            candidates = find_transfer_candidates(conn)
            for candidate in candidates:
                reason = candidate.match_reason
                print(
                    f"out #{candidate.out_transaction_id} <-> in #{candidate.in_transaction_id}  "
                    f"{_fmt_minor(candidate.amount_out_minor)} -> {_fmt_minor(candidate.amount_in_minor)}  "
                    f"Δ{candidate.delta_minutes}min  fee {_fmt_minor(candidate.fee_minor)}  "
                    f"[{reason.get('out_account')} -> {reason.get('in_account')}]"
                )
            print(f"-- {len(candidates)} candidate(s); auto pairing stops at PROBABLE, confirm by hand")
        elif args.action == "suggest":
            applied = suggest_transfers(conn)
            for candidate in applied:
                print(
                    f"paired #{candidate.out_transaction_id} <-> #{candidate.in_transaction_id} "
                    f"as {candidate.suggested_status} (Δ{candidate.delta_minutes}min)"
                )
            print(f"-- {len(applied)} pair(s) suggested")
        elif args.action == "list":
            rows = list_pairs(conn, args.status)
            for pair in rows:
                print(
                    f"pair #{pair['pair_id']:<4} {pair['pair_status']:<10} by {pair['paired_by']:<6} "
                    f"out #{pair['out_id']} {_fmt_minor(pair['out_amount'])} ({pair['out_account']}) -> "
                    f"in #{pair['in_id']} {_fmt_minor(pair['in_amount'])} ({pair['in_account']})  "
                    f"fee {_fmt_minor(pair['fee_minor'])}"
                )
            print(f"-- {len(rows)} pair(s)")
        elif args.action == "confirm":
            confirm_pair(conn, args.pair_id)
            print(f"pair #{args.pair_id} confirmed")
        elif args.action == "unpair":
            out_id, in_id = unpair(conn, args.pair_id)
            print(f"pair #{args.pair_id} dissolved (#{out_id} <-> #{in_id}); rejection remembered")
        elif args.action == "link":
            create_pair(
                conn,
                args.out_transaction_id,
                args.in_transaction_id,
                pair_status="CONFIRMED",
                match_reason={"note": args.note or "manual link"},
                paired_by="MANUAL",
            )
            conn.commit()
            print(f"manual pair #{args.out_transaction_id} <-> #{args.in_transaction_id} created (CONFIRMED)")
    return 0


def cmd_refunds(args) -> int:
    with open_db(args.db) as conn:
        if args.action == "list":
            rows = list_refund_links(conn, args.status)
            for link in rows:
                original = (
                    f"original #{link['original_id']} {_fmt_minor(link['original_amount'])} @ {link['original_at'][:10]}"
                    if link["original_id"]
                    else "original: NOT FOUND"
                )
                print(
                    f"refund #{link['refund_transaction_id']:<5} {link['link_status']:<10} "
                    f"{_fmt_minor(link['refund_amount']):>10} @ {link['refund_at'][:10]}  {original}  "
                    f"{(link.get('refund_counterparty') or '')[:20]}"
                )
            print(f"-- {len(rows)} refund link(s)")
        elif args.action == "resolve":
            candidates = suggest_refunds(conn)
            leftover = mark_all_unresolved(conn)
            for candidate in candidates:
                print(
                    f"linked refund #{candidate.refund_transaction_id} -> original "
                    f"#{candidate.original_transaction_id} (PROBABLE, Δ{candidate.delta_days}d)"
                )
            print(f"-- {len(candidates)} auto link(s); {leftover} refund(s) explicitly UNRESOLVED")
        elif args.action == "confirm":
            confirm_refund_link(conn, args.refund_transaction_id)
            print(f"refund #{args.refund_transaction_id} link confirmed")
        elif args.action == "link":
            link_refund(
                conn,
                args.refund_transaction_id,
                args.original_transaction_id,
                link_status="CONFIRMED",
                match_reason={"note": "manual link"},
                paired_by="MANUAL",
            )
            conn.commit()
            print(f"manual link refund #{args.refund_transaction_id} -> original #{args.original_transaction_id}")
        elif args.action == "unlink":
            unlink_refund(conn, args.refund_transaction_id)
            print(f"refund #{args.refund_transaction_id} unlinked (UNRESOLVED)")
    return 0


def cmd_classify(args) -> int:
    with open_db(args.db) as conn:
        seed_all(conn)
        if args.action == "groups":
            groups = review.unclassified_groups(conn, tx_type=args.type, limit=args.limit)
            summary = review.unclassified_summary(conn)
            print(f"未分类 {summary['rows']} 笔，共 {summary['groups']} 组（按金额降序）")
            for group in groups:
                print(
                    f"  [{group['ttype']:<7}] {(group['text'] or '(无文本)'):<36} "
                    f"{group['n']:>4} 笔  {_fmt_minor(group['total_minor']):>12}  {group['channels']}"
                )
            return 0
        if args.action == "rule":
            if not args.type or args.type not in ("EXPENSE", "INCOME"):
                raise SystemExit("classify rule 需要 --type EXPENSE 或 INCOME（规则按交易类型生效）")
            if not args.pattern or not args.category:
                raise SystemExit("用法: classify rule <匹配文本> <类别代码> --type EXPENSE|INCOME [--field …] [--match-mode …]")
            rule_id = review.create_group_rule(
                conn,
                group_text=args.pattern,
                tx_type=args.type,
                category_code=args.category.upper(),
                rule_name=args.name or None,
            )
            if args.match_mode != "CONTAINS" or args.field != "all_text":
                # Non-default matching: rewrite the fields the review helper fixed.
                conn.execute(
                    """
                    UPDATE classification_rules SET match_field = ?, match_mode = ?
                    WHERE rule_id = ?
                    """,
                    (args.field, args.match_mode, rule_id),
                )
                conn.commit()
            remaining = review.apply_rules(conn)
            print(f"规则 #{rule_id}: {args.field} {args.match_mode} '{args.pattern}' -> {args.category.upper()}")
            print(f"剩余未分类 {remaining} 笔")
            return 0
        if args.action == "review":
            stats = review.review_unclassified(conn, tx_type=args.type)
            print(
                f"review 结束：{stats['rules_created']} 条新规则，{stats['skipped']} 组跳过"
                + ("（提前退出）" if stats["quit"] else "")
            )
            return 0
        stats = classify_transactions(conn, recompute=args.recompute)
        energy_stats = refresh_energy_interpretations(conn)
        print(
            "classification: {classified} classified, {unclassified} unclassified, "
            "{kept_manual} manual kept, {kept_existing} already classified, {recomputed} recomputed".format(**stats)
        )
        print(f"energy interpretation: {energy_stats['materialized']} materialized, {energy_stats['kept_manual']} manual kept")
    return 0


def cmd_reconcile(args) -> int:
    with open_db(args.db) as conn:
        seed_all(conn)
        print("== reconcile: transfer suggestions")
        applied = suggest_transfers(conn)
        for candidate in applied:
            print(
                f"  paired #{candidate.out_transaction_id} <-> #{candidate.in_transaction_id} "
                f"as {candidate.suggested_status} (Δ{candidate.delta_minutes}min)"
            )
        print(f"  {len(applied)} transfer pair(s) suggested")

        print("== reconcile: refund links")
        refunds = suggest_refunds(conn)
        unresolved = mark_all_unresolved(conn)
        for candidate in refunds:
            print(
                f"  refund #{candidate.refund_transaction_id} -> #{candidate.original_transaction_id} "
                f"(PROBABLE, Δ{candidate.delta_days}d)"
            )
        print(f"  {len(refunds)} refund link(s) suggested; {unresolved} explicitly UNRESOLVED")

        print("== reconcile: energy interpretation")
        energy_stats = refresh_energy_interpretations(conn)
        print(f"  {energy_stats['materialized']} interpretation(s) refreshed")

        groups = unresolved_transactions(conn, limit=5)
        total = sum(len(rows) for rows in groups.values())
        print(f"== unresolved items (all kinds): {total} — query details with 'transactions unresolved'")
    return 0


def cmd_energy_summary(args) -> int:
    with open_db(args.db) as conn:
        if args.month:
            start, end = month_bounds(args.month)
        else:
            raise SystemExit("--month YYYY-MM is required (period accounting is always explicit)")
        summary = summarize_period(conn, start, end)
        data = summary.to_dict()
        print(f"period: {args.month}")
        print(f"  schema month range: {start} .. {end}")
        print()
        for energy_type, entry in data["energy_by_type"].items():
            print(f"  {entry['label']:<40} {_fmt_minor(entry['minor']):>12}  ({entry['count']} tx)")
        print()
        print(f"  transfer net (should be 0):      {_fmt_minor(summary.transfer_net_minor):>12}")
        print(f"  transfer fees (consumed):        {_fmt_minor(summary.transfer_fee_minor):>12}")
        print(f"  net storage change:              {_fmt_minor(summary.net_storage_change_minor):>12}")
        print(f"  identity delta (I-C-E+R+I'-F):   {_fmt_minor(summary.identity_delta_minor):>12}")
        if summary.balanced:
            print("  reconciliation: BALANCED")
        else:
            print(
                f"  reconciliation: UNRECONCILED — unreconciled amount "
                f"{_fmt_minor(summary.unreconciled_minor)} "
                f"({summary.unknown_count} unknown-energy tx, {summary.unpaired_transfer_count} unpaired transfer leg(s)); "
                f"no automatic adjustment will be made"
            )
        if args.json:
            print(json.dumps(data, ensure_ascii=False, indent=2))
    return 0


def cmd_energy_override(args) -> int:
    with open_db(args.db) as conn:
        override_energy_type(conn, args.transaction_id, args.energy_type, note=args.note)
        tx = get_transaction(conn, args.transaction_id)
        print(f"transaction #{args.transaction_id} energy reading -> {args.energy_type} (manual override; facts untouched)")
        print(_tx_line(tx))
    return 0


def _town_state_or_exit(args):
    if not args.month:
        raise SystemExit("--month YYYY-MM is required (Town State is period state)")
    with open_db(args.db) as conn:
        return build_town_state(conn, args.month)


def cmd_town(args) -> int:
    """生活小镇 Town State:纯派生、只读投影,数据库零写入。"""
    state = _town_state_or_exit(args)
    if args.action == "state":
        print(town_service.format_town_state(state))
        if getattr(args, "json", False):
            print()
            print(json.dumps(state.to_dict(), ensure_ascii=False, indent=2))
    elif args.action == "scenes":
        if getattr(args, "json", False):
            scenes = {scene.scene: scene.to_dict() for scene in state.scenes}
            print(json.dumps({"period": state.period.to_dict(), "scenes": scenes,
                              "projection_version": PROJECTION_VERSION},
                             ensure_ascii=False, indent=2))
        else:
            print(town_service.format_scenes(state))
    elif args.action == "explain":
        print(town_service.format_explanations(state))
    return 0


def cmd_town_world_show(args) -> int:
    """持久化世界层（TownWorldState）：先幂等 bootstrap，再确定性读出。

    只读命令——唯一可能发生的写入是首次触发 seed（§7），与账本零接触。
    """
    from ..living_town.world import ensure_world, load_world

    with open_db(args.db) as conn:
        ensure_world(conn)
        state = load_world(conn)

    if args.json:
        print(json.dumps(state.to_dict(), ensure_ascii=False, indent=2))
        return 0

    active = state.active_buildings()
    print(
        f"world: {state.world_version} @ {state.layout_version}  "
        f"revision {state.revision}"
    )
    seeded = next(
        (b.created_at for b in state.buildings if (b.provenance or {}).get("source") == "bootstrap-seed"),
        None,
    )
    if seeded:
        print(f"seeded at: {seeded}")
    print(f"buildings: {len(state.buildings)} ({len(active)} active, {len(state.buildings) - len(active)} demolished)")
    for b in state.buildings:
        print(f"  {b.building_id}  {b.asset_id:<18} ({b.grid_x},{b.grid_y}) {b.orientation}  {b.lifecycle}")
    return 0


def cmd_town_world_serve(args) -> int:
    """本地 world service：只绑定 127.0.0.1，web 经 vite proxy 同源访问。"""
    from ..living_town.world.api import serve
    from ..living_town.world.runtime_port import resolve_world_port

    serve(args.db, port=args.port if args.port is not None else resolve_world_port())
    return 0


def cmd_town_building(args) -> int:
    """世界层变更：全部经由 world domain service（不允许裸 SQL 写世界表）。

    CLI 与未来 web 共用同一 service；失败时输出稳定错误码并以退出码 1 结束。
    """
    from ..living_town.world.errors import WorldCommandError
    from ..living_town.world.service import (
        change_building_asset,
        create_building,
        demolish_building,
        move_building,
    )

    with open_db(args.db) as conn:
        try:
            if args.building_action == "create":
                state = create_building(
                    conn,
                    asset_id=args.asset,
                    grid_x=args.x,
                    grid_y=args.y,
                    orientation=args.orientation,
                    expected_revision=args.revision,
                    via="cli",
                )
                created = [
                    b
                    for b in state.buildings
                    if (b.provenance or {}).get("command")
                    == {"type": "CreateBuilding", "asset_id": args.asset, "grid_x": args.x,
                        "grid_y": args.y, "orientation": args.orientation}
                ]
            elif args.building_action == "move":
                state = move_building(
                    conn,
                    building_id=args.id,
                    grid_x=args.x,
                    grid_y=args.y,
                    orientation=args.orientation,
                    expected_revision=args.revision,
                    via="cli",
                )
                created = [b for b in state.buildings if b.building_id == args.id]
            elif args.building_action == "change-asset":
                state = change_building_asset(
                    conn, building_id=args.id, asset_id=args.asset, expected_revision=args.revision, via="cli"
                )
                created = [b for b in state.buildings if b.building_id == args.id]
            else:  # demolish
                state = demolish_building(conn, building_id=args.id, expected_revision=args.revision, via="cli")
                created = [b for b in state.buildings if b.building_id == args.id]
        except WorldCommandError as exc:
            detail = f" {exc.detail}" if exc.detail else ""
            print(f"error: {exc.code}: {exc.message}{detail}", file=sys.stderr)
            return 1
    print(f"ok: {args.building_action} applied, world revision {state.revision}")
    for b in created:
        print(f"  {b.building_id}  {b.asset_id} ({b.grid_x},{b.grid_y}) {b.orientation} {b.lifecycle}")
    return 0


# ------------------------------------------------------------------ wiring


def build_parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(
        prog="life-energy",
        description="Local-first personal cash-flow ledger with Life Energy interpretation",
    )
    root.add_argument("--db", default=str(default_db_path()), help=f"ledger database path (env LIFE_ENERGY_DB; default {default_db_path()})")
    root.add_argument("--version", action="version", version=f"life-energy {__version__}")
    sub = root.add_subparsers(dest="command", required=True)

    db = sub.add_parser("db", help="database and migration status")
    db_sub = db.add_subparsers(dest="action", required=True)
    db_sub.add_parser("status", help="show schema version, migrations and counts").set_defaults(func=cmd_db_status)
    db_sub.add_parser("migrate", help="apply pending migrations").set_defaults(func=cmd_db_status)

    imp = sub.add_parser("import", help="import a bill file (idempotent)")
    imp_sub = imp.add_subparsers(dest="channel", required=True)
    channels = ("wechat", "alipay", "bank", *sorted(BANK_PARSERS))
    for channel in channels:
        channel_parser = imp_sub.add_parser(channel, help=f"import {channel} bill")
        channel_parser.add_argument("file", help="path to the exported bill (original is never modified)")
        channel_parser.add_argument("--account", help="fallback account name for rows whose payment method has no alias")
        channel_parser.set_defaults(func=cmd_import, channel=channel)

    accounts = sub.add_parser("accounts", help="manage accounts and channel aliases")
    accounts_sub = accounts.add_subparsers(dest="action", required=True)
    accounts_add = accounts_sub.add_parser("add")
    accounts_add.add_argument("name")
    accounts_add.add_argument("--type", default="CASH", choices=accounts_service.VALID_ACCOUNT_TYPES)
    accounts_add.add_argument("--institution")
    accounts_add.add_argument("--masked-number")
    accounts_add.set_defaults(func=cmd_accounts)
    accounts_alias = accounts_sub.add_parser("alias")
    accounts_alias.add_argument("account_name")
    accounts_alias.add_argument("channel", help="wechat | alipay | bank:generic_csv ...")
    accounts_alias.add_argument("value", help="payment-method text as it appears in bills")
    accounts_alias.add_argument("--prefix", action="store_true", help="match by prefix instead of exact equality")
    accounts_alias.set_defaults(func=cmd_accounts)
    accounts_reattr = accounts_sub.add_parser("reattribute", help="re-run alias attribution after adding aliases")
    accounts_reattr.add_argument("--channel", help="limit to one channel (wechat / alipay / bank:...)")
    accounts_reattr.set_defaults(func=cmd_accounts)
    accounts_sub.add_parser("list").set_defaults(func=cmd_accounts)

    transactions = sub.add_parser("transactions", help="inspect canonical transactions")
    transactions_sub = transactions.add_subparsers(dest="action", required=True)
    tx_list = transactions_sub.add_parser("list")
    tx_list.add_argument("--month", help="YYYY-MM")
    tx_list.add_argument("--type", help="INCOME|EXPENSE|TRANSFER|REFUND|INVESTMENT|UNKNOWN")
    tx_list.add_argument("--limit", type=int, default=50)
    tx_list.set_defaults(func=cmd_transactions)
    tx_unresolved = transactions_sub.add_parser("unresolved")
    tx_unresolved.add_argument("--limit", type=int, default=10)
    tx_unresolved.set_defaults(func=cmd_transactions)
    tx_show = transactions_sub.add_parser("show")
    tx_show.add_argument("transaction_id", type=int)
    tx_show.set_defaults(func=cmd_transactions)
    tx_override = transactions_sub.add_parser("override")
    tx_override.add_argument("transaction_id", type=int)
    tx_override.add_argument("category", help="category code, e.g. FOOD")
    tx_override.add_argument("--note", default="")
    tx_override.set_defaults(func=cmd_transactions)

    transfers = sub.add_parser("transfers", help="internal transfer pairing")
    transfers_sub = transfers.add_subparsers(dest="action", required=True)
    transfers_sub.add_parser("candidates").set_defaults(func=cmd_transfers)
    transfers_sub.add_parser("suggest").set_defaults(func=cmd_transfers)
    transfers_list = transfers_sub.add_parser("list")
    transfers_list.add_argument("--status", choices=["CONFIRMED", "PROBABLE", "UNCERTAIN"])
    transfers_list.set_defaults(func=cmd_transfers)
    transfers_confirm = transfers_sub.add_parser("confirm")
    transfers_confirm.add_argument("pair_id", type=int)
    transfers_confirm.set_defaults(func=cmd_transfers)
    transfers_unpair = transfers_sub.add_parser("unpair")
    transfers_unpair.add_argument("pair_id", type=int)
    transfers_unpair.set_defaults(func=cmd_transfers)
    transfers_link = transfers_sub.add_parser("link")
    transfers_link.add_argument("out_transaction_id", type=int)
    transfers_link.add_argument("in_transaction_id", type=int)
    transfers_link.add_argument("--note", default="")
    transfers_link.set_defaults(func=cmd_transfers)

    refunds = sub.add_parser("refunds", help="refund -> original transaction links")
    refunds_sub = refunds.add_subparsers(dest="action", required=True)
    refunds_list = refunds_sub.add_parser("list")
    refunds_list.add_argument("--status", choices=["CONFIRMED", "PROBABLE", "UNRESOLVED"])
    refunds_list.set_defaults(func=cmd_refunds)
    refunds_sub.add_parser("resolve").set_defaults(func=cmd_refunds)
    refunds_confirm = refunds_sub.add_parser("confirm")
    refunds_confirm.add_argument("refund_transaction_id", type=int)
    refunds_confirm.set_defaults(func=cmd_refunds)
    refunds_link = refunds_sub.add_parser("link")
    refunds_link.add_argument("refund_transaction_id", type=int)
    refunds_link.add_argument("original_transaction_id", type=int)
    refunds_link.set_defaults(func=cmd_refunds)
    refunds_unlink = refunds_sub.add_parser("unlink")
    refunds_unlink.add_argument("refund_transaction_id", type=int)
    refunds_unlink.set_defaults(func=cmd_refunds)

    classify = sub.add_parser("classify", help="run the deterministic classification chain")
    classify.add_argument("--recompute", action="store_true", help="re-run rules on previously classified rows (manual overrides always kept)")
    classify.add_argument("action", nargs="?", choices=("groups", "rule", "review"),
                          help="groups: list unclassified merchant groups; review: interactive one-decision-per-group; rule: add one rule")
    classify.add_argument("--type", help="[groups/rule/review] limit to EXPENSE or INCOME")
    classify.add_argument("--limit", type=int, default=30, help="[groups] how many groups to list")
    classify.add_argument("pattern", nargs="?", help="[rule] text to match")
    classify.add_argument("category", nargs="?", help="[rule] category code, e.g. FOOD")
    classify.add_argument("--field", default="all_text", choices=("all_text", "counterparty", "description", "merchant"), help="[rule] match field")
    classify.add_argument("--match-mode", default="CONTAINS", choices=("CONTAINS", "PREFIX", "EQUALS"), help="[rule] match mode")
    classify.add_argument("--name", default="", help="[rule] optional rule name")
    classify.set_defaults(func=cmd_classify)

    sub.add_parser("reconcile", help="suggest transfer pairs + refund links, refresh interpretations").set_defaults(func=cmd_reconcile)

    evidence = sub.add_parser("evidence", help="Otter Evidence registration status (read-only)")
    evidence_sub = evidence.add_subparsers(dest="action", required=True)
    evidence_sub.add_parser("status", help="registration + extraction state of every import batch").set_defaults(func=cmd_evidence)

    energy = sub.add_parser("energy", help="Life Energy interpretation layer")
    energy_sub = energy.add_subparsers(dest="action", required=True)
    energy_summary = energy_sub.add_parser("summary")
    energy_summary.add_argument("--month", required=True, help="YYYY-MM")
    energy_summary.add_argument("--json", action="store_true", help="also print raw JSON")
    energy_summary.set_defaults(func=cmd_energy_summary)
    energy_override = energy_sub.add_parser("override", help="human-confirmed energy reading for one transaction")
    energy_override.add_argument("transaction_id", type=int)
    energy_override.add_argument("energy_type", choices=[
        "ENERGY_INPUT", "ENERGY_CONSUMPTION", "ENERGY_TRANSFER",
        "ENERGY_EXPORT", "ENERGY_IMPORT", "ENERGY_RETURN", "ENERGY_UNKNOWN",
    ])
    energy_override.add_argument("--note", default="", help="why (stored as provenance)")
    energy_override.set_defaults(func=cmd_energy_override)

    town = sub.add_parser("town", help="生活小镇 Town State 投影（纯派生只读层）")
    town_sub = town.add_subparsers(dest="action", required=True)
    town_state = town_sub.add_parser("state", help="project the period Town State")
    town_state.add_argument("--month", required=True, help="YYYY-MM")
    town_state.add_argument("--json", action="store_true", help="also print the full JSON shape")
    town_state.set_defaults(func=cmd_town)
    town_scenes = town_sub.add_parser("scenes", help="scene activity for the period")
    town_scenes.add_argument("--month", required=True, help="YYYY-MM")
    town_scenes.add_argument("--json", action="store_true", help="print JSON instead of a table")
    town_scenes.set_defaults(func=cmd_town)
    town_explain = town_sub.add_parser("explain", help="why each state metric is what it is")
    town_explain.add_argument("--month", required=True, help="YYYY-MM")
    town_explain.set_defaults(func=cmd_town)

    town_world = town_sub.add_parser("world", help="持久化世界层 TownWorldState（建筑身份与坐标）")
    town_world_sub = town_world.add_subparsers(dest="world_action", required=True)
    town_world_show = town_world_sub.add_parser("show", help="show the persisted world (read-only)")
    town_world_show.add_argument("--json", action="store_true", help="print the full TownWorldState JSON")
    town_world_show.set_defaults(func=cmd_town_world_show)
    town_world_serve = town_world_sub.add_parser("serve", help="serve the world over local HTTP (127.0.0.1 only)")
    town_world_serve.add_argument(
        "--port",
        type=int,
        default=None,
        help="TCP port (default: LIFE_ENERGY_WORLD_PORT, else config/local-runtime.json, else 8642)",
    )
    town_world_serve.set_defaults(func=cmd_town_world_serve)

    town_building = town_sub.add_parser("building", help="world mutations (via the domain service)")
    town_building_sub = town_building.add_subparsers(dest="building_action", required=True)
    b_create = town_building_sub.add_parser("create", help="place a new building")
    b_create.add_argument("--asset", required=True, help="placeable asset id, e.g. residential_a")
    b_create.add_argument("--x", required=True, type=int, help="footprint north-corner anchor")
    b_create.add_argument("--y", required=True, type=int, help="footprint north-corner anchor")
    b_create.add_argument("--orientation", default="S")
    b_create.add_argument("--revision", required=True, type=int, help="current world revision (see town world show)")
    b_create.set_defaults(func=cmd_town_building)
    b_move = town_building_sub.add_parser("move", help="move a building (identity unchanged)")
    b_move.add_argument("--id", required=True, help="building uuid")
    b_move.add_argument("--x", required=True, type=int)
    b_move.add_argument("--y", required=True, type=int)
    b_move.add_argument("--orientation", default=None)
    b_move.add_argument("--revision", required=True, type=int)
    b_move.set_defaults(func=cmd_town_building)
    b_asset = town_building_sub.add_parser("change-asset", help="rebuild as another placeable asset (identity unchanged)")
    b_asset.add_argument("--id", required=True, help="building uuid")
    b_asset.add_argument("--asset", required=True)
    b_asset.add_argument("--revision", required=True, type=int)
    b_asset.set_defaults(func=cmd_town_building)
    b_demolish = town_building_sub.add_parser("demolish", help="soft-demolish (row and uuid are kept)")
    b_demolish.add_argument("--id", required=True, help="building uuid")
    b_demolish.add_argument("--revision", required=True, type=int)
    b_demolish.set_defaults(func=cmd_town_building)

    return root


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
