# ADR-004: Local World Runtime Contract

Status: ACCEPTED
Date: 2026-09-14

## Context

The Web workbench needs a narrow transport to read TownState/world data and submit
world commands. A local launcher must distinguish readiness from a process merely
occupying the expected port.

## Decision

Use a stdlib HTTP service bound only to `127.0.0.1:8642`, with
`GET /api/health` as the readiness/identity probe. Vite uses strict port 5173.
Town-world writes use one JSON command endpoint, localhost Origin/Host checks and
optimistic `expected_revision`; stable domain error codes are protocol surface.
Financial projection endpoints are read-only. SQLite and domain services remain the
authority; the browser is a transport client.

## Consequences

Port or health payload changes require coordination with Harbor. The service is a
local-development/runtime boundary, not an authenticated Internet API. A first world
read can intentionally bootstrap seed state, so an operator must not describe every
world endpoint as physically read-only.

## Alternatives Rejected

- Browser access to SQLite.
- Port fallback that silently breaks launcher discovery.
- Client-authoritative placement or last-write-wins world mutations.
- Treating this localhost service as a production Internet service.

See `src/life_energy/living_town/world/api.py`, `web/vite.config.ts` and
`docs/living-town-world-contract.md`.
