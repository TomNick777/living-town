"""Life Energy model: pure derived semantics over canonical facts.

    External income        -> ENERGY_INPUT
    Real life consumption  -> ENERGY_CONSUMPTION
    Own-account movement   -> ENERGY_TRANSFER  (neutral to input AND consumption)
    Into long-term saving  -> ENERGY_EXPORT    (leaves the life cash system)
    Back from investments  -> ENERGY_IMPORT    (mirrors export; adjustment leg)
    Refund of a past cost  -> ENERGY_RETURN    (never ENERGY_INPUT)
    Fund-to-fund moves     -> ENERGY_INVESTMENT_INTERNAL (no cash-system impact)
    Not honestly placeable -> ENERGY_UNKNOWN   (surfaces as unreconciled)

Energy is an interpretation, never a fact: it lives in the derived layer and
every assignment carries ``energy_derived_from`` provenance. Nothing here can
mutate ``transactions``.

Storage identity (the reconciliation invariant):

    net_storage_change  ==  input - consumption - export + return + import - transfer_fees

Transfer fees leak out of the cash system, so they are consumed on the
identity side. If the two sides disagree — or ENERGY_UNKNOWN amounts exist —
the difference is reported as unreconciled, never silently absorbed, and no
adjustment transactions are ever fabricated.
"""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass, field
from datetime import datetime, timezone

ENERGY_INPUT = "ENERGY_INPUT"
ENERGY_CONSUMPTION = "ENERGY_CONSUMPTION"
ENERGY_TRANSFER = "ENERGY_TRANSFER"
ENERGY_EXPORT = "ENERGY_EXPORT"
ENERGY_IMPORT = "ENERGY_IMPORT"
ENERGY_RETURN = "ENERGY_RETURN"
ENERGY_INVESTMENT_INTERNAL = "ENERGY_INVESTMENT_INTERNAL"
ENERGY_UNKNOWN = "ENERGY_UNKNOWN"

ENERGY_TYPES = (
    ENERGY_INPUT,
    ENERGY_CONSUMPTION,
    ENERGY_TRANSFER,
    ENERGY_EXPORT,
    ENERGY_IMPORT,
    ENERGY_RETURN,
    ENERGY_INVESTMENT_INTERNAL,
    ENERGY_UNKNOWN,
)


def _is_fund_conversion(description: str) -> bool:
    """Fund-to-fund conversion legs (转换/转入成功/确认成功退款): investment-
    internal movements. Keywords shared with normalization.enums by value —
    kept local to avoid energy depending on the normalization package."""
    text = (description or "").strip()
    return any(marker in text for marker in ("转换", "转入成功", "确认成功退款"))


def signed_minor(amount_minor: int, direction: str) -> int:
    """Signed cash-system flow: inflow positive, outflow negative, neutral zero."""
    if direction == "INFLOW":
        return amount_minor
    if direction == "OUTFLOW":
        return -amount_minor
    return 0


def energy_type_for(transaction: dict, pair_status: str | None, refund_status: str | None) -> tuple[str, dict]:
    """Derive (energy_type, provenance) from canonical facts + pairing state.

    ``transaction`` is a row from transactions (+ account name/type when
    available). This function is pure: no DB, no mutation.
    """
    transaction_type = transaction["transaction_type"]
    direction = transaction["direction"]
    provenance = {"transaction_type": transaction_type, "direction": direction}

    if transaction_type == "INCOME":
        return ENERGY_INPUT, provenance
    if transaction_type == "EXPENSE":
        provenance["basis"] = "real life consumption (not transfer, not investment)"
        return ENERGY_CONSUMPTION, provenance
    if transaction_type == "TRANSFER":
        provenance["pair_status"] = pair_status or "UNPAIRED"
        provenance["note"] = "internal movement between own accounts; neutral to input and consumption"
        return ENERGY_TRANSFER, provenance
    if transaction_type == "INVESTMENT":
        if direction == "OUTFLOW":
            provenance["destination_account"] = transaction.get("account_name")
            provenance["destination_account_type"] = transaction.get("account_type")
            provenance["note"] = "leaves the life cash system into long-term saving"
            return ENERGY_EXPORT, provenance
        if direction == "INFLOW":
            provenance["source_account"] = transaction.get("account_name")
            provenance["note"] = "returns from the investment system; mirror of ENERGY_EXPORT"
            return ENERGY_IMPORT, provenance
        if _is_fund_conversion(transaction.get("description") or ""):
            provenance["note"] = "fund-to-fund conversion inside the investment system; no cash-system impact"
            return ENERGY_INVESTMENT_INTERNAL, provenance
        provenance["note"] = "investment move without a determinable direction; needs human review"
        return ENERGY_UNKNOWN, provenance
    if transaction_type == "REFUND":
        provenance["refund_link_status"] = refund_status or "UNLINKED"
        provenance["note"] = "money returned from a past consumption; not external income"
        return ENERGY_RETURN, provenance

    provenance["note"] = "cannot be placed honestly; counted as unreconciled"
    return ENERGY_UNKNOWN, provenance


def load_energy_rows(conn: sqlite3.Connection, start: str | None = None, end: str | None = None) -> list[dict]:
    """Transactions joined with pairing state, in [start, end) when given."""
    where, params = "", []
    if start and end:
        where = "WHERE t.occurred_at >= ? AND t.occurred_at < ?"
        params = [start, end]
    rows = conn.execute(
        f"""
        SELECT t.transaction_id, t.occurred_at, t.transaction_type, t.direction, t.amount_minor,
               t.counterparty, t.description, t.source,
               a.name AS account_name, a.account_type AS account_type,
               tp.pair_status AS transfer_pair_status,
               rl.link_status AS refund_link_status,
               i.investment_attribution, i.category_code, i.is_manual_override,
               i.energy_type AS override_energy_type
        FROM transactions t
        LEFT JOIN accounts a ON a.account_id = t.source_account_id
        LEFT JOIN transfer_pairs tp ON tp.out_transaction_id = t.transaction_id OR tp.in_transaction_id = t.transaction_id
        LEFT JOIN refund_links rl ON rl.refund_transaction_id = t.transaction_id
        LEFT JOIN transaction_interpretation i ON i.transaction_id = t.transaction_id
        {where}
        ORDER BY t.occurred_at, t.transaction_id
        """,
        params,
    ).fetchall()
    # tp/rl joins may duplicate rows if schema ever allows several pairs; v1
    # constraints (UNIQUE legs / UNIQUE refund) guarantee one row per tx.
    return [dict(row) for row in rows]


def classify_energy(rows: list[dict]) -> list[dict]:
    """Attach (energy_type, provenance) to each ledger row.

    A manual energy override (interpretation row written by a human decision)
    wins over the automatic reading — but stays honest by carrying
    ``manual_override`` provenance.
    """
    enriched = []
    for row in rows:
        if row.get("is_manual_override") and row.get("override_energy_type"):
            energy_type, provenance = energy_type_for(
                row, row.get("transfer_pair_status"), row.get("refund_link_status")
            )
            provenance = {
                **provenance,
                "manual_override": True,
                "automatic_reading": energy_type,
                "note": "human-confirmed energy reading; see CLI 'energy override'",
            }
            energy_type = row["override_energy_type"]
        else:
            energy_type, provenance = energy_type_for(
                row, row.get("transfer_pair_status"), row.get("refund_link_status")
            )
        if row.get("account_type") == "INVESTMENT" and energy_type == ENERGY_EXPORT:
            provenance["destination_account_role"] = "INVESTMENT"
        enriched.append({**row, "energy_type": energy_type, "energy_derived_from": provenance})
    return enriched


@dataclass
class EnergySummary:
    start: str
    end: str
    by_type_minor: dict = field(default_factory=dict)
    by_type_count: dict = field(default_factory=dict)
    transfer_net_minor: int = 0
    transfer_fee_minor: int = 0
    unreconciled_minor: int = 0
    unknown_count: int = 0
    unpaired_transfer_count: int = 0
    net_storage_change_minor: int = 0
    identity_delta_minor: int = 0
    balanced: bool = False

    @property
    def input_minor(self) -> int:
        return self.by_type_minor.get(ENERGY_INPUT, 0)

    @property
    def consumption_minor(self) -> int:
        return self.by_type_minor.get(ENERGY_CONSUMPTION, 0)

    @property
    def export_minor(self) -> int:
        return self.by_type_minor.get(ENERGY_EXPORT, 0)

    @property
    def import_minor(self) -> int:
        return self.by_type_minor.get(ENERGY_IMPORT, 0)

    @property
    def return_minor(self) -> int:
        return self.by_type_minor.get(ENERGY_RETURN, 0)

    def to_dict(self) -> dict:
        from .display import type_label

        return {
            "period": {"start": self.start, "end": self.end},
            "energy_by_type": {
                energy_type: {
                    "minor": self.by_type_minor.get(energy_type, 0),
                    "count": self.by_type_count.get(energy_type, 0),
                    "label": type_label(energy_type),
                }
                for energy_type in ENERGY_TYPES
                if self.by_type_count.get(energy_type)
            },
            "transfer_net_minor": self.transfer_net_minor,
            "transfer_fee_minor": self.transfer_fee_minor,
            "unreconciled_minor": self.unreconciled_minor,
            "unknown_count": self.unknown_count,
            "unpaired_transfer_count": self.unpaired_transfer_count,
            "net_storage_change_minor": self.net_storage_change_minor,
            "identity_delta_minor": self.identity_delta_minor,
            "balanced": self.balanced,
        }


def summarize_period(conn: sqlite3.Connection, start: str, end: str) -> EnergySummary:
    """Compute the period's energy accounting and its reconciliation identity."""
    rows = classify_energy(load_energy_rows(conn, start, end))

    summary = EnergySummary(start=start, end=end)
    unknown_signed = 0

    for row in rows:
        energy_type = row["energy_type"]
        signed = signed_minor(row["amount_minor"], row["direction"])
        summary.by_type_minor[energy_type] = summary.by_type_minor.get(energy_type, 0) + abs(signed)
        summary.by_type_count[energy_type] = summary.by_type_count.get(energy_type, 0) + 1

        # Storage arithmetic: every real cash movement, signed.
        summary.net_storage_change_minor += signed

        if energy_type == ENERGY_TRANSFER:
            summary.transfer_net_minor += signed
            if row.get("transfer_pair_status") is None:
                summary.unpaired_transfer_count += 1
        elif energy_type == ENERGY_UNKNOWN:
            unknown_signed += signed
            summary.unknown_count += 1

    # Transfer fees are captured once per pair (the out leg carries the fee).
    fee_row = conn.execute(
        """
        SELECT SUM(tp.fee_minor) AS fees FROM transfer_pairs tp
        JOIN transactions tout ON tout.transaction_id = tp.out_transaction_id
        WHERE tout.occurred_at >= ? AND tout.occurred_at < ?
        """,
        (start, end),
    ).fetchone()
    summary.transfer_fee_minor = fee_row["fees"] or 0 if fee_row else 0

    # Reconciliation identity: input - consumption - export + return + import - fees
    summary.identity_delta_minor = (
        summary.input_minor
        - summary.consumption_minor
        - summary.export_minor
        + summary.return_minor
        + summary.import_minor
        - summary.transfer_fee_minor
    )

    # Unreconciled: unknown energy (never guessed into a bucket) plus any
    # transfer legs that do not net to zero (a leg is missing from the ledger).
    summary.unreconciled_minor = abs(unknown_signed) + abs(summary.transfer_net_minor)
    summary.balanced = (
        summary.identity_delta_minor == summary.net_storage_change_minor
        and summary.unreconciled_minor == 0
    )
    return summary
