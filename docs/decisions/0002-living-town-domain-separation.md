# ADR-002: Living Town Expression and World-State Separation

Status: ACCEPTED
Date: 2026-09-09

## Context

The product needed an expressive model of daily life without turning visual metaphors
into accounting facts or coupling building identity to transaction categories.

## Decision

Use “生活小镇” as the product expression while retaining Life Energy as internal
derived vocabulary. TownState is a period-based, fully recomputable read model from
ledger data. TownWorldState is a separate persistent model of user building intent,
with permanent UUIDs, placement and lifecycle. The two meet only during scene
composition. Buildings never map one-to-one to spending categories and never generate
financial facts.

## Consequences

The browser consumes validated TownState/world JSON and contains no financial
calculation or SQLite access. World mutations go through the domain service and do not
touch canonical ledger tables. Product naming can evolve without renaming the package,
schema or energy enums.

## Alternatives Rejected

- A building-per-category accounting schema.
- Persisting TownState snapshots as financial facts.
- Deriving building existence or identity from monthly spending.
- Renaming the ledger/schema to match the visual metaphor.

See `docs/life-town.md`, `docs/living-town-world-contract.md` and
`docs/living-town-renderer-architecture.md`.
