# Dependency request — Agent D (CRITICAL_GATE_REPEATABILITY_V1)

Phase: AUTOMATED_PG16_RELEASE_GATE_V1 · Branch: `ci/repeatability-audit-v1`

## 1. `.gitignore` entry for `artifacts/` (owner: repo scaffold / integration)

`scripts/ci/repeatability-rounds.mjs` writes its evidence record to
`artifacts/ci/repeatability.json`. That file is LOCAL evidence and must never be committed
(it embeds absolute local paths and machine-specific timing), but `.gitignore` currently has
no `artifacts/` entry, so the file shows up as untracked noise in `git status`.

Agent D does not own `.gitignore` — requesting the owning agent add:

```gitignore
artifacts/
```

Until then this branch simply does not stage the file (verified before every commit).

## 2. No other dependencies

- No new npm packages were needed (the driver reuses `pg` and `scripts/backup/pg-lib.mjs`).
- No changes requested to `vitest.config.ts` — its `fileParallelism: false` setting is a
  load-bearing input to the repeatability analysis and is documented in
  `docs/release-candidate/CRITICAL_GATE_REPEATABILITY_REPORT.md`.
