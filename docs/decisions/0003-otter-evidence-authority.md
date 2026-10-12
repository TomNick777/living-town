# ADR-003: Otter Evidence Authority and Fail-Open Bridge

Status: ACCEPTED
Date: 2026-09-10

## Context

File identity, location reconciliation and extraction history need one cross-project
authority. Reimplementing that registry in the ledger would create conflicting truth,
while making imports depend on the external service would threaten local bookkeeping.

## Decision

Otter Evidence is authoritative for evidence identity and processing state.
`import_batches` remains a local idempotency cache. After import, the ledger reports
evidence/extraction over HTTP. The bridge never opens the Evidence database and is
fail-open for ledger writes: unavailability is reported but cannot roll back a valid
local import.

## Consequences

Authoritative evidence-status queries require the external service. Degraded local
views must be labeled non-authoritative. Bridge calls must be idempotent, never alter
ledger facts and never raise into the import path.

## Alternatives Rejected

- Treating `import_batches` as the cross-project evidence authority.
- Directly reading or writing the Evidence SQLite schema.
- Failing a valid ledger import when the Evidence service is unavailable.

See `docs/evidence-bridge.md` and invariants 20-21 in `docs/data-invariants.md`.
