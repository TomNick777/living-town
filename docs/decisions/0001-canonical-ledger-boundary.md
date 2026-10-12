# ADR-001: Canonical Ledger and Derived Semantics

Status: ACCEPTED
Date: 2026-09-07

## Context

Personal-finance imports contain immutable source evidence, normalized facts and
fallible interpretation. Combining them would make corrections destroy provenance or
let presentation needs alter financial history.

## Decision

Use three layers: append-only raw evidence, immutable canonical transactions, and
recomputable/overridable derived interpretation. Store money as non-negative integer
minor units with sign in `direction`. Model transfers, refunds and investments as
first-class facts. Report discrepancies instead of synthesizing balancing entries.

## Consequences

Corrections occur through interpretation, pairing, linking or explicit override.
Every inference needs provenance. Schema evolution is incremental and formal
databases are never rebuilt as an upgrade strategy. The narrow, documented
`source_account_id` reattribution exception remains debt until it gains a durable
audit trail.

## Alternatives Rejected

- Editing imported transactions to reflect later interpretation.
- Signed floating-point amounts.
- Treating internal transfers or refunds as income/expense.
- Automatic opening balances or adjustment transactions.

See `docs/data-invariants.md` and `docs/architecture.md`.
