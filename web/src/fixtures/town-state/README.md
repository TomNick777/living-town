# Town State fixtures (synthetic)

Hand-authored `living-town-v1` Town State documents used to develop and
test the renderer without any real bill. Shape follows
`docs/living-town-ui-contract.md` exactly (integer minor amounts, 0..1
scores, bands, scenes, unresolved, explanations).

| file | demo | visual intent |
|---|---|---|
| `stable.json` | A | Stable everyday life — NORMAL / STABLE / NORMAL / HEALTHY / LOW / HEALTHY |
| `busy-tight.json` | B | Busy but financially tight — BUSY / FRAGILE / SEVERE / LOW / NONE / HEALTHY |
| `capital-export.json` | C | Stable + capital export — NORMAL / STRONG / LOW / STRONG / HIGH / HEALTHY |

Honesty notes:

- These are **synthetic demo states**. Their `state.*` bands are authored to
  exercise the visual mapping; they were **not** produced by running
  `town-rules-v1` on a database. Financial blocks are internally consistent
  (identity holds, shares sum to 1) but a few explanation factors are marked
  `(synthetic demo factor)` where the authored band would not follow from the
  listed numbers under the real rules.
- Real states come from `life-energy town state --month YYYY-MM --json`; the
  adapter (`src/town/adapter/townState.ts`) accepts that CLI output directly.
- No real bill data is ever stored here.
