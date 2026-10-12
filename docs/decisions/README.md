# Architecture Decision Records

This directory records accepted decisions whose rationale is not safely recoverable
from code alone. ADRs are long-lived constraints, not progress reports or ordinary
change logs. Current capability and verification status belongs in
`PROJECT_STATE.md`; detailed component design remains in the existing architecture
documents.

## Index

- [ADR-001](0001-canonical-ledger-boundary.md) — canonical ledger and derived semantics
- [ADR-002](0002-living-town-domain-separation.md) — Living Town expression and world-state separation
- [ADR-003](0003-otter-evidence-authority.md) — Otter Evidence authority and fail-open bridge
- [ADR-004](0004-local-world-runtime-contract.md) — localhost world runtime contract

## Lifecycle

Use the next zero-padded number. Status is `PROPOSED`, `ACCEPTED`, `SUPERSEDED` or
`REJECTED`. Do not edit the decision of an accepted ADR to reverse it; add a new ADR
and mark the old one superseded. Keep each record concise and link to detailed
contracts instead of duplicating them.

```markdown
# ADR-XXX: Title

Status: PROPOSED
Date: YYYY-MM-DD

## Context

## Decision

## Consequences

## Alternatives Rejected
```

Existing `docs/life-town.md` and the Living Town contract/freeze documents remain
valid detailed decision sources. These ADRs provide the durable index and rationale;
they do not replace those documents.
