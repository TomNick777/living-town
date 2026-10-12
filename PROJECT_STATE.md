# PROJECT STATE

Last verified: 2026-10-12 (Asia/Shanghai)
Verified HEAD: resolve with `git log -1 -- PROJECT_STATE.md`.
Branch: `main`. Public snapshot starts with new history; private repository history is not included.

## Scope — feature development frozen

Living Town is a personal portfolio: a standalone, fully synthetic React/Three.js
site, backed by the source and tests of a local-first Python/SQLite ledger.
Default routes show overview, monthly board and transaction review. `?local`
explicitly uses the local ledger service; `?workbench` retains the SVG editor.
Old `?demo` / `?townDemo` links use the unified default showcase.

All public money comes from Python read projections. The browser validates,
renders and selects rows; it does not calculate financial summaries or open SQLite.
Transfers, refunds, investments and unresolved facts retain their semantics.

## Release checkpoint

- Imported 569 entirely synthetic CSV rows through the actual ledger pipeline,
  classified and reconciled them, and generated six monthly projections plus a year projection.
- One reproducible snapshot supplies TownState, TownPeriod, LedgerBoard and LedgerReview.
  The final month deliberately retains an unknown type, unmatched refund and one-sided transfer.
- Default transport fetches only the static demo bundle. Local API failures never
  fall back to synthetic data. Static preview has its API proxy disabled.
- Consolidated showcase initialization/retry, lazy-loaded the maintenance workbench,
  removed the second standalone demo page and legacy 3D geometry, and moved shared
  world types out of the legacy builder.
- Excluded thirteen migration/pilot/review modules, their seven dedicated test files,
  one-time scripts, private rules, operational audits and obsolete plans from this snapshot.
  Kept ledger, world service, Evidence fail-open bridge and TownEvents v3/delta contracts.
- Replaced stale product documentation with scope, architecture, reproduction,
  release instructions, synthetic screenshots and MIT license. Source provenance is acknowledged.
- Added GitHub Actions verification and Pages deployment. Deployment status must
  be checked separately; a local build is not proof of online publication.

## Fresh verification

| Check | Result |
|---|---|
| `python -m pytest` | 368 passed |
| `python scripts/build_demo.py --check` | Committed snapshot matches a fresh temporary-ledger projection |
| `cd web && npm test` | 312 passed, 33 files |
| `npm run build` | Typecheck and Vite production build passed |
| `python scripts/audit_release.py` | Public file audit passed; synthetic source and screenshots manually reviewed |
| Browser root and `/living-town/` subpath | Static assets, JSON snapshot and lazy 3D chunk loaded; no ledger API requests |
| Browser interactions | Month/year switch, board, review, pending filter and second page verified |
| Mobile 390 × 844 | No page-level horizontal overflow; full-width headings; table scrolls inside its container |
| Formal data | No formal SQLite or personal bills opened; original private repository was preserved |

All test data is synthetic. Backend test count differs from the private snapshot
because migration/pilot capabilities and their dedicated tests were excluded,
not because failing ledger tests were dropped.

## Remaining limits and maintenance boundary

- WebGL is required for the 3D view; desktop remains the strongest presentation.
- Three.js chunk is about 592 kB before gzip (153 kB gzip); Vite reports its size warning.
- Annual overview is an annual snapshot; board/review use the last available month
  in that year with an explicit hint. There is no annual transaction workbench.
- Synthetic data illustrates behavior; it is not a reconstruction of anyone's finances or location.
- SVG workbench, older replay road graph and local event contracts remain compatibility
  surface. Do not expand them or delete them without reviewing callers and tests.
- No cloud ledger, budgets, bank API, AI classification product or production Evidence migration.

Maintenance should focus on reproducibility, correctness, privacy and broken display paths.
Public screenshots must always be regenerated from synthetic data.
