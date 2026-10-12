"""town-events-v3: cross-system fact feed for Otter City (Phase 1 contract).

town-events-v2 是小镇表达层的投影：只投影 EXPENSE 与 SALARY 收入，
并携带 target/behavior/intensity 表达语义（见 town_events.py 的边界承诺：
"转账 / 退款 / 投资不是小镇生活活动，不产生城市事件"——那是对的，
对表达层而言）。Otter City 消费的是事实面，不是表达面，所以本投影
是同一账本上的另一个版本化合同，而不是对 v2 的隐式修改：

    canonical ledger -> build_town_events_v3 -> /api/town-events-v3 -> Otter City

边界承诺：

- 只读：零写入派生投影（与 town-events/town-state 同一纪律）；
- 全类型：六种 transaction_type 全部投影。转账 / 退款 / 投资/
  非工资收入是城市合同需要的事实；
- 状态诚实：refund_links / transfer_pairs 的配对状态原样携带
  （CONFIRMED / PROBABLE / UNRESOLVED / UNCERTAIN / null）。
  没有 refund_links 行时 refund_link = null——"未尝试配对"与
  "UNRESOLVED" 是不同的事实，不合并；消费方不得把 PROBABLE /
  UNRESOLVED / null 当成已确认；
- 溯源：source_reference（渠道原生 id）与 canonical_fingerprint
  （内容 sha256）原样发布，供消费方构建 FactReference 回指；
  不发布 raw_payload / import 批次 / 分类规则等内部实现；
- 时间诚实：occurred_at（渠道事实时间，+08:00）与 recorded_at
  （账本 canonical 行入库时间，UTC）分开发布；只有日期的来源
  time_precision = "DAY"（00:00:00 不伪装成时刻，沿用 v2 原则）；
- 金额：整数分 + currency，不引入浮点；direction 携带符号，
  amount_minor 恒非负；
- 分类未知诚实：category_code / classification_source 为 null
  就是"未分类"，不猜、不补默认值；
- 确定性：文档不含 generated_at——同一 (数据, 查询) 永远得到
  逐字节相同的文档。事件按 transaction_id 升序全序输出；
- 增量：游标 = transaction_id（AUTOINCREMENT，插入序单调）。
  回填历史导入会拿到新 id，因此 since_id 游标不漏事件；
  不要求消费方全量重扫历史；
- revision：ledger_revision.digest 是对**本投影发布的全部字段**
  的内容 sha256（含 interpretation_version、refund/transfer 配对
  状态、账户归属）。任何被发布字段发生变化——包括
  PROBABLE->CONFIRMED 的原位翻转与重新归属——digest 必然变化；
  digest 不变 => 本投影的全部事实不变。max_* 与 *_counts 字段
  只作诊断，不是变更判据。

2026-10-01 按用户「Otter City — Phase 1: Live Contract Foundation」
指令新增；v2 及其 web 消费方不受影响。
"""

from __future__ import annotations

import hashlib
import sqlite3
import threading
from collections import OrderedDict

from ..ledger.queries import month_bounds

TOWN_EVENTS_V3_VERSION = "town-events-v3"

DEFAULT_LIMIT = 1000
MAX_LIMIT = 2000

_EVENT_SELECT = """
SELECT t.transaction_id, t.occurred_at, t.created_at,
       t.source, t.counterparty, t.description, t.status,
       t.amount_minor, t.currency, t.direction, t.transaction_type,
       t.source_reference, t.canonical_fingerprint,
       a.name AS account_name, a.account_type,
       i.category_code, i.classification_source, i.interpretation_version,
       i.energy_type,
       c.name AS category_name,
       tpo.pair_id AS out_pair_id, tpo.pair_status AS out_pair_status,
       tpo.fee_minor AS out_fee_minor,
       tpi.pair_id AS in_pair_id, tpi.pair_status AS in_pair_status,
       tpi.fee_minor AS in_fee_minor,
       rl.link_status AS refund_link_status,
       rl.original_transaction_id AS refund_original_transaction_id
FROM transactions t
LEFT JOIN accounts a ON a.account_id = t.source_account_id
LEFT JOIN transaction_interpretation i ON i.transaction_id = t.transaction_id
LEFT JOIN categories c ON c.code = i.category_code
LEFT JOIN transfer_pairs tpo ON tpo.out_transaction_id = t.transaction_id
LEFT JOIN transfer_pairs tpi ON tpi.in_transaction_id = t.transaction_id
LEFT JOIN refund_links rl ON rl.refund_transaction_id = t.transaction_id
"""

# Digest scan: exactly the columns the event projection publishes (plus the
# ids needed to identify rows). Any change to a published value changes the
# digest; nothing else can.
_DIGEST_SELECT = """
SELECT t.transaction_id, t.occurred_at, t.created_at,
       t.source, t.counterparty, t.description, t.status,
       t.amount_minor, t.currency, t.direction, t.transaction_type,
       t.source_reference, t.canonical_fingerprint, t.source_account_id,
       i.category_code, i.classification_source, i.interpretation_version,
       i.energy_type,
       tpo.pair_id, tpo.pair_status, tpo.fee_minor,
       tpi.pair_id, tpi.pair_status, tpi.fee_minor,
       rl.refund_link_id, rl.link_status, rl.original_transaction_id
FROM transactions t
LEFT JOIN transaction_interpretation i ON i.transaction_id = t.transaction_id
LEFT JOIN transfer_pairs tpo ON tpo.out_transaction_id = t.transaction_id
LEFT JOIN transfer_pairs tpi ON tpi.in_transaction_id = t.transaction_id
LEFT JOIN refund_links rl ON rl.refund_transaction_id = t.transaction_id
ORDER BY t.transaction_id
"""


def project_row_v3(row: dict) -> dict:
    """One canonical ledger row -> one v3 fact event (no presentation semantics)."""
    occurred_at = row["occurred_at"]
    # 00:00:00 的来源几乎都是只有日期的账单；真实午夜交易无法与日期
    # 精度区分，一律按 DAY，绝不伪装时刻（与 v2 同一原则）。
    precise = occurred_at[11:19] != "00:00:00"
    pair = _pair_from(row)
    return {
        "id": f"te:{row['transaction_id']}",
        "transaction_id": row["transaction_id"],
        "transaction_type": row["transaction_type"],
        "occurred_at": occurred_at,
        "time_precision": "SECOND" if precise else "DAY",
        "recorded_at": row["created_at"],
        "direction": row["direction"],
        "amount_minor": row["amount_minor"],
        "currency": row["currency"],
        "source": row["source"],
        "source_reference": row["source_reference"],
        "canonical_fingerprint": row["canonical_fingerprint"],
        "account_name": row["account_name"],
        "account_type": row["account_type"],
        "counterparty": row["counterparty"],
        "description": row["description"],
        "status": row["status"],
        "category_code": row["category_code"],
        "category_name": row["category_name"],
        "classification_source": row["classification_source"],
        "interpretation_version": row["interpretation_version"],
        "energy_type": row["energy_type"],
        "transfer_pair": pair,
        "refund_link": (
            {
                "link_status": row["refund_link_status"],
                "original_transaction_id": row["refund_original_transaction_id"],
            }
            if row["refund_link_status"] is not None
            else None
        ),
    }


def _pair_from(row: dict) -> dict | None:
    """Merge the two unique-indexed pair joins; a row sits in at most one pair."""
    if row["out_pair_id"] is not None:
        return {
            "pair_id": row["out_pair_id"],
            "pair_status": row["out_pair_status"],
            "fee_minor": row["out_fee_minor"],
        }
    if row["in_pair_id"] is not None:
        return {
            "pair_id": row["in_pair_id"],
            "pair_status": row["in_pair_status"],
            "fee_minor": row["in_fee_minor"],
        }
    return None


def _row_line(row: sqlite3.Row) -> bytes:
    """The exact byte line one row contributes to the digest chain."""
    return (
        "\x1e".join("" if value is None else str(value) for value in tuple(row)).encode(
            "utf-8"
        )
        + b"\x1f"
    )


def _ledger_revision(conn: sqlite3.Connection) -> dict:
    """Content digest over every published field + cheap diagnostic counters."""
    rows = conn.execute(_DIGEST_SELECT).fetchall()
    digest = hashlib.sha256()
    max_transaction_id = 0
    max_interpretation_version = 0
    unattributed = 0
    refund_counts: dict[str, int] = {}
    transfer_counts: dict[str, int] = {}
    for row in rows:
        if row["transaction_id"] > max_transaction_id:
            max_transaction_id = row["transaction_id"]
        version = row["interpretation_version"]
        if version is not None and version > max_interpretation_version:
            max_interpretation_version = version
        if row["source_account_id"] is None:
            unattributed += 1
        if row["link_status"] is not None:
            refund_counts[row["link_status"]] = refund_counts.get(row["link_status"], 0) + 1
        for status in (row[19], row[22]):  # out_pair_status, in_pair_status columns
            if status is not None:
                transfer_counts[status] = transfer_counts.get(status, 0) + 1
        digest.update(_row_line(row))
    return {
        "digest": f"sha256:{digest.hexdigest()}",
        "transaction_count": len(rows),
        "max_transaction_id": max_transaction_id,
        "max_interpretation_version": max_interpretation_version,
        "unattributed_transaction_count": unattributed,
        "refund_link_status_counts": dict(sorted(refund_counts.items())),
        "transfer_pair_status_counts": dict(sorted(transfer_counts.items())),
    }


def build_town_events_v3(
    conn: sqlite3.Connection,
    *,
    since_id: int = 0,
    limit: int = DEFAULT_LIMIT,
    month: str | None = None,
) -> dict:
    """Incremental, deterministic v3 fact document.

    Deterministic given (db, since_id, limit, month): byte-identical JSON for
    identical inputs, no clock anywhere in the document.
    """
    where = "WHERE t.transaction_id > ?"
    params: list[object] = [since_id]
    if month is not None:
        start, end = month_bounds(month)
        where += " AND t.occurred_at >= ? AND t.occurred_at < ?"
        params.extend([start, end])
    # Fetch one extra row so has_more is a fact, not a guess.
    rows = [
        dict(row)
        for row in conn.execute(
            f"{_EVENT_SELECT} {where} ORDER BY t.transaction_id ASC LIMIT ?",
            [*params, limit + 1],
        ).fetchall()
    ]
    has_more = len(rows) > limit
    events = [project_row_v3(row) for row in rows[:limit]]
    next_since_id = events[-1]["transaction_id"] if events else since_id
    return {
        "projection_version": TOWN_EVENTS_V3_VERSION,
        "ledger_revision": _ledger_revision(conn),
        "query": {"since_id": since_id, "limit": limit, "month": month},
        "cursor": {
            "next_since_id": next_since_id if has_more else None,
            "has_more": has_more,
            "returned": len(events),
        },
        "events": events,
    }


# --- delta surface (town-events-v3-delta/1, Phase 2D) ----------------------
#
# A minimal legacy-consumer change index so Otter City's warm startup does
# not re-download the whole ledger. This is NOT town-events-v4 and not CDC:
# the event contract is untouched, the ledger schema is untouched, nothing
# writes anywhere. The surface is a separate endpoint served from the same
# module, with its own honesty rules:
#
# - cursor = generation = the `ledger_revision.digest` of the state the
#   consumer has fully incorporated. The digest covers every published field
#   of every row, so equal generations prove zero semantic delta (§ no
#   change) without comparing rows at all.
# - a *known* older generation is diffed against the journal's per-row
#   digest snapshot: `upserts` (new or changed rows, full v3 event payloads)
#   and `invalidations` (transaction_ids no longer published). Upserts are
#   idempotent — consumers replace by transaction_id.
# - an *unknown* generation (first contact, journal pruned, producer
#   restart) gets `resync: true`: the consumer re-bootstraps through the
#   plain v3 surface. Never a guess.
# - the journal is process-local derived state, kept in memory only; delta
#   documents therefore depend on producer history and are deliberately NOT
#   part of the byte-determinism promise of the v3 surface above.

DELTA_SURFACE_VERSION = "town-events-v3-delta/1"
DELTA_MAX_UPSERTS = 2000
DELTA_JOURNAL_CAPACITY = 8


class TownEventsDeltaIndex:
    """In-memory generation journal over the v3 projection (read-only).

    Each generation's per-row digest snapshot is remembered so a consumer
    can advance across several generations without full rescans. Snapshots
    are pure derivatives of the ledger; nothing is persisted and nothing is
    written to the database.
    """

    def __init__(self, capacity: int = DELTA_JOURNAL_CAPACITY) -> None:
        self._capacity = max(1, capacity)
        self._lock = threading.Lock()
        self._snapshots: OrderedDict[str, dict[int, str]] = OrderedDict()

    def scan(self, conn: sqlite3.Connection) -> tuple[str, dict[int, str]]:
        """One pass over the digest scan: (global generation, per-row digests).

        The global hash chain is byte-identical to ``_ledger_revision`` so a
        generation taken from a v3 document is valid on the delta surface.
        """
        digest = hashlib.sha256()
        row_digests: dict[int, str] = {}
        for row in conn.execute(_DIGEST_SELECT).fetchall():
            digest.update(_row_line(row))
            row_digests[row["transaction_id"]] = hashlib.sha256(
                _row_line(row)
            ).hexdigest()
        return f"sha256:{digest.hexdigest()}", row_digests

    def remember(self, generation: str, row_digests: dict[int, str]) -> None:
        with self._lock:
            self._snapshots[generation] = row_digests
            self._snapshots.move_to_end(generation)
            while len(self._snapshots) > self._capacity:
                self._snapshots.popitem(last=False)

    def knows(self, generation: str | None) -> bool:
        if generation is None:
            return False
        with self._lock:
            return generation in self._snapshots

    def snapshot(self, generation: str) -> dict[int, str] | None:
        with self._lock:
            rows = self._snapshots.get(generation)
            return dict(rows) if rows is not None else None


def _delta_changed_rows(
    conn: sqlite3.Connection, wanted: set[int]
) -> list[dict]:
    """Full v3 event payloads for the given transaction ids (id order)."""
    if not wanted:
        return []
    events: list[dict] = []
    for row in conn.execute(f"{_EVENT_SELECT} ORDER BY t.transaction_id ASC").fetchall():
        if row["transaction_id"] in wanted:
            events.append(project_row_v3(dict(row)))
    return events


def build_town_events_v3_delta(
    index: TownEventsDeltaIndex,
    conn: sqlite3.Connection,
    *,
    acknowledged_generation: str | None,
    max_upserts: int = DELTA_MAX_UPSERTS,
) -> dict:
    """Compute the semantic delta between a consumer generation and now.

    Deterministic given (db, journal state, acknowledged_generation); the
    journal state itself is derived only from ledger content, and unknown
    generations degrade to an explicit resync rather than a partial guess.
    """
    current, row_digests = index.scan(conn)
    revision = _ledger_revision(conn)
    unchanged = acknowledged_generation == current
    resync = False
    reason: str | None = None
    upserts: list[dict] = []
    invalidations: list[int] = []
    previous = (
        index.snapshot(acknowledged_generation) if acknowledged_generation else None
    )
    # Journal the current snapshot after the lookup: remembering first could
    # evict the very snapshot this request is diffing against (tiny journals).
    index.remember(current, row_digests)
    if not unchanged:
        if previous is None:
            resync = True
            reason = "unknown-generation" if acknowledged_generation else "no-generation"
        else:
            changed = {
                transaction_id
                for transaction_id, row_digest in row_digests.items()
                if previous.get(transaction_id) != row_digest
            }
            invalidations = sorted(
                transaction_id for transaction_id in previous if transaction_id not in row_digests
            )
            if len(changed) > max_upserts:
                resync = True
                reason = "delta-too-large"
                changed = set()
                invalidations = []
            else:
                upserts = _delta_changed_rows(conn, changed)

    return {
        "projection_version": TOWN_EVENTS_V3_VERSION,
        "surface": DELTA_SURFACE_VERSION,
        "ledger_revision": revision,
        "generation": {
            "current": current,
            "acknowledged": acknowledged_generation,
            "unchanged": unchanged,
            "resync": resync,
            "reason": reason,
        },
        "upserts": upserts,
        "invalidations": invalidations,
        "counts": {
            "upserts": len(upserts),
            "invalidations": len(invalidations),
            "transaction_count": revision["transaction_count"],
        },
    }
