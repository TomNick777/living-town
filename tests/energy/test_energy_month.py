"""Life Energy derived layer: the five energies, neutrality, reconciliation.

Expected values for the full synthetic month (all after reconcile):

    INPUT        25000.00  (salary 20000 + salary 5000)
    CONSUMPTION    277.00  (32 + 100 + 18.50 + 9.90 + 50 + 66.60 消费)
    RETURN         150.00  (100 full + 20 partial + 30 orphan)
    EXPORT        8000.00  (余额宝 3000 + fund 5000)
    TRANSFER net    -88.00 (4 paired legs net 0; the 88 leg has no counter leg)
    UNKNOWN          5.00  (untyped wallet row) -> unreconciled
    net storage  16780.00
    identity     16873.00  (25000 - 277.00 - 8000 + 150)
    unreconciled    93.00  (5.00 unknown + 88.00 lone transfer leg) -> 9300 fen

    2026-09 bank-keyword update: 消费 is deterministic channel semantics
    (merchant consumption), so the generic-bank row '消费 未知商户' reads as
    EXPENSE now; only the genuinely unplaceable row stays UNKNOWN.
"""

from __future__ import annotations

import json

from life_energy.energy.interpret import refresh_energy_interpretations
from life_energy.energy.model import ENERGY_INPUT, summarize_period
from life_energy.ledger.queries import month_bounds


def test_full_month_energy_accounting(ledger):
    start, end = month_bounds("2026-08")
    summary = summarize_period(ledger, start, end)

    assert summary.input_minor == 2_500_000
    assert summary.consumption_minor == 27_700
    assert summary.return_minor == 15_000
    assert summary.export_minor == 800_000
    assert summary.import_minor == 0

    assert summary.transfer_net_minor == -8_800
    assert summary.unpaired_transfer_count == 1
    assert summary.unknown_count == 1

    assert summary.net_storage_change_minor == 1_678_000
    assert summary.identity_delta_minor == 1_687_300
    assert summary.unreconciled_minor == 9_300
    assert summary.balanced is False  # honest: the month has real unknowns


def test_energy_types_are_as_designed(ledger):
    from life_energy.energy.model import classify_energy, load_energy_rows

    rows = classify_energy(load_energy_rows(ledger))
    by_type = {}
    for row in rows:
        by_type.setdefault(row["energy_type"], []).append(row)

    assert len(by_type[ENERGY_INPUT]) == 2
    # every transfer leg is ENERGY_TRANSFER, paired or not
    assert all(row["energy_type"] == "ENERGY_TRANSFER" for row in rows if row["transaction_type"] == "TRANSFER")
    # investment outflows are EXPORT, never consumption
    assert all(row["energy_type"] == "ENERGY_EXPORT" for row in rows if row["transaction_type"] == "INVESTMENT")


def test_energy_neutrality_of_internal_transfers(ledger):
    """Internal A->B movements never contribute to Input or Consumption."""
    from life_energy.energy.model import classify_energy, load_energy_rows

    rows = classify_energy(load_energy_rows(ledger))
    for row in rows:
        if row["transaction_type"] == "TRANSFER":
            assert row["energy_type"] == "ENERGY_TRANSFER"
            assert row["energy_type"] not in (ENERGY_INPUT, "ENERGY_CONSUMPTION")


def test_interpretations_materialize_with_provenance(ledger):
    stats = refresh_energy_interpretations(ledger)
    assert stats["materialized"] == ledger.execute("SELECT COUNT(*) FROM transactions").fetchone()[0]

    row = ledger.execute(
        """
        SELECT i.energy_type, i.energy_derived_from FROM transaction_interpretation i
        JOIN transactions t ON t.transaction_id = i.transaction_id
        WHERE t.transaction_type = 'INVESTMENT' LIMIT 1
        """
    ).fetchone()
    assert row["energy_type"] == "ENERGY_EXPORT"
    provenance = json.loads(row["energy_derived_from"])
    assert provenance["transaction_type"] == "INVESTMENT"
    assert provenance["direction"] == "OUTFLOW"
    assert "long-term saving" in provenance["note"]


def test_energy_summary_json_shape(ledger):
    start, end = month_bounds("2026-08")
    data = summarize_period(ledger, start, end).to_dict()
    assert data["energy_by_type"]["ENERGY_INPUT"]["minor"] == 2_500_000
    assert data["unreconciled_minor"] == 9_300
    assert data["balanced"] is False
