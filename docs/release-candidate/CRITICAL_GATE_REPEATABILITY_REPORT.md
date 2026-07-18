# CRITICAL_GATE_REPEATABILITY_V1 — three-round repeatability audit

- Phase: `AUTOMATED_PG16_RELEASE_GATE_V1` · Agent D · Branch: `ci/repeatability-audit-v1` (baseline `c7c2ab4`)
- Driver: `scripts/ci/repeatability-rounds.mjs` (`node scripts/ci/repeatability-rounds.mjs`)
- Executed: 2026-07-18T16:37:07Z → 16:38:26Z · total runtime **78.8 s**
- Environment: local PostgreSQL **18.3** on `localhost:5432` · Node 22 · vitest 4.1 (`fileParallelism: false`)
- Evidence record: `artifacts/ci/repeatability.json` (local, NOT committed) + per-gate child logs in the run's temp directory

## Verdict

**FLAKY_GATE count: 0.** All seven critical gates produced identical PASS results across three
consecutive rounds, each round on fresh, uniquely-named, never-reused throwaway databases.
Identical test counts in every round (no drift), zero skipped tests inside any counted gate,
residual-state checks clean before and after every round.

## Methodology

Three consecutive rounds, strictly sequential (no gate overlaps any other). Round *N*:

1. **Residual-state check** — the admin role lists `geoplane_rep_*` databases and asserts the
   round's two names do not already exist (proves round *N* cannot inherit round *N−1* state).
2. **Provision** — `CREATE DATABASE geoplane_rep_rN_test OWNER geoplane_app` (fresh, empty).
3. **Run the seven gates** against that database by overriding `GEO_TEST_DATABASE_URL` in each
   child-process environment. Every gate reuses the existing production tooling/suites — the
   driver adds no test logic of its own.
4. **Teardown** — `DROP DATABASE … WITH (FORCE)` for `geoplane_rep_rN_test` and
   `geoplane_rep_rN_restore_test`, then re-list and assert both are gone.

Honesty rules enforced by the driver:

- A vitest gate is **FAIL unless ≥ 1 test actually ran and passed and zero tests were
  skipped** (exception: the `-t`-filtered concurrent-idempotency gate, which must pass
  **exactly 1** test and only its filtered-out siblings may show as skipped). Every `*.pg`
  suite skips silently when no test database resolves — under these rules that silence is a
  FAIL, not a green gate.
- **No rerun-until-green.** Each gate executed exactly once per round; every raw result was
  recorded as it happened.
- Passwords flow only via child env (`GEO_TEST_DATABASE_URL` / `PGPASSWORD`); nothing secret
  is printed or written to the artifact. Production/recovery-named databases are refused by
  the reused `scripts/backup/pg-lib.mjs` guards. `RUN_PROVIDER_CANARY` is stripped from every
  child environment — zero real provider calls occurred (only offline suites were invoked).

### Gate → tooling map

| # | Gate id | Reused tooling |
|---|---------|----------------|
| 1 | `migration-apply-0001-0008` | `scripts/db/migrate.mjs --test`; PASS requires exit 0, exactly **8 applied**, zero `skip` lines (proves the DB was truly fresh) |
| 2 | `db-purpose-preflight` | `scripts/preflight/database-environment.mjs`; PASS requires `RESULT: PASS` **and** that the test role validated the round DB by name |
| 3 | `tenant-isolation` | vitest `tests/persistence/pg-tenancy-runtime.pg.test.ts` + `pg-tenancy-b2.pg.test.ts` (DB-enforced tenancy invariants, membership exclusivity, append-only artifact_index, repo factory + tx rollback) |
| 4 | `concurrent-idempotency` | vitest `-t "collapses 10 concurrent same-key creates into exactly one organization"` (10 concurrent same-key creates → exactly 1 row) |
| 5 | `provider-ledger-append-only` | vitest `tests/runtime/provider/provider-ledger.pg.test.ts` + `provider-identity-migration.pg.test.ts` (append-only triggers, no-content columns, identity columns 0008 incl. legacy backfill + fresh-DB migrate CLI replay) |
| 6 | `product-restart-e2e` | vitest `tests/pilot/pilot-resilience.e2e.pg.test.ts` (application restart over a fresh pool, session key rotation, in-suite backup/restore drill) |
| 7 | `backup-restore-e2e` | `scripts/backup/backup.mjs --test` → `scripts/backup/restore.mjs --db geoplane_rep_rN_restore_test`; PASS requires restored tables/triggers to equal the source and `schema_migrations` = 8 rows in the restored copy |

## Per-round matrix

| Gate | Round 1 | Round 2 | Round 3 |
|------|---------|---------|---------|
| migration-apply-0001-0008 | PASS (0.7 s) | PASS (1.1 s) | PASS (0.6 s) |
| db-purpose-preflight | PASS (0.4 s) | PASS (0.4 s) | PASS (0.4 s) |
| tenant-isolation | PASS 9/9 (5.2 s) | PASS 9/9 (4.8 s) | PASS 9/9 (4.6 s) |
| concurrent-idempotency | PASS 1/1 (1.6 s) | PASS 1/1 (1.6 s) | PASS 1/1 (1.7 s) |
| provider-ledger-append-only | PASS 13/13 (8.0 s) | PASS 13/13 (7.6 s) | PASS 13/13 (7.8 s) |
| product-restart-e2e | PASS 3/3 (7.7 s) | PASS 3/3 (7.0 s) | PASS 3/3 (7.0 s) |
| backup-restore-e2e | PASS (2.3 s) | PASS (2.0 s) | PASS (2.0 s) |

Backup→restore shape verification, identical in all three rounds:
source `{tables: 42, triggers: 25, ledger: 8}` → restored `{tables: 42, triggers: 25, ledger: 8}`.

**FLAKY_GATE count: 0** (a FLAKY_GATE would be any gate whose status differs across rounds).
Test-count drift across rounds: none (9/1/13/3 in every round).

## The five risk questions

1. **Shared-database interference.** The write path of every round touched only that round's
   own `geoplane_rep_rN_test` / `geoplane_rep_rN_restore_test`. Two bounded read-only shared
   touchpoints remain: (a) `db-purpose-preflight` also validates the shared runtime and canary
   databases (`GEO_DATABASE_URL` / `GEO_CANARY_DATABASE_URL` from `.env.local`) — read-only
   checks, but a migration regression on those shared DBs would fail gate 2 for reasons
   external to the round; (b) all rounds share one PostgreSQL 18.3 instance, so cluster-level
   settings are common cause. Neither produced interference in this run.

2. **Concurrent-TRUNCATE interference.** The `*.pg` suites reset shared tables with
   `TRUNCATE … CASCADE` in `beforeEach`, so two DB-backed test FILES running concurrently
   could truncate each other mid-test. `vitest.config.ts` sets `fileParallelism: false`
   (verified programmatically by the driver each run), serializing file execution; in
   addition the driver runs gates strictly sequentially and each round owns a private
   database no other process knows about. Both layers held: no truncate race was observed,
   and identical counts across rounds are consistent with none occurring.

3. **Order dependence.** Rounds are independent by construction — each starts from
   `CREATE DATABASE` on an empty, never-before-used name and gate 1 proves emptiness (8 fresh
   applies, zero `skip` lines). A result carried over from a previous round is therefore
   impossible. Within a round the gate order is fixed and intentional (migrate before
   preflight before suites); this audit does not permute intra-round gate order, so
   *intra-round* order independence is asserted by design (fresh schema + per-suite
   `beforeAll` re-migration + `beforeEach` truncation), not by permutation testing.

4. **Residual cross-test state.** Before every round the driver asserted no
   `geoplane_rep_*` database existed (result: none, all three rounds), and after every round
   it dropped both round databases and re-verified (`droppedClean: true` ×3). The suites'
   own throwaway databases (`geoplane_bkp_*`, pilot-resilience restore targets) use unique
   per-run suffixes and self-drop in `afterAll`.

5. **Accidentally-green (skip-masking).** The known trap: every `*.pg` suite
   `describe.skipIf(testConfig === null)`-skips cleanly, and vitest still exits 0 — a broken
   env override would look green. The driver treats *zero tests ran* and *any unexpected
   skipped test* as FAIL, and cross-checks per-gate passed-test counts across rounds (any
   drift is flagged). All counted gates ran their full test set in all three rounds.

## Caveats (honest)

- **Local runs are PostgreSQL 18.3, not 16.** This audit proves repeatability of the gates on
  the local PG18 instance; the same gates run against PostgreSQL 16 in the remote CI workflow
  (`ci/postgres16-release-gate-v1` line of work). PG16-specific behavior is NOT covered here.
- **Three rounds bound, not eliminate, flake risk.** Three consecutive passes with identical
  counts is strong evidence against systematic flakiness, but a low-probability flake
  (< ~1/3 rate) could evade three rounds. The driver is rerunnable (`node
  scripts/ci/repeatability-rounds.mjs`) if a longer soak is wanted.
- **Single machine, sequential execution.** No cross-process contention was exercised beyond
  what the suites create internally (e.g. the 10-connection concurrent-create test); this
  matches how the gates run in CI (serialized files) but does not stress multi-runner setups.
- **Gate 2 spans shared read-only databases** (see risk question 1): its verdict partially
  depends on the shared runtime/canary DBs staying migrated, which is outside a round's
  control.
- **Timing variance is real but small** (e.g. migration apply 0.6–1.1 s); durations in the
  matrix are informational, not gate criteria.
- `artifacts/ci/repeatability.json` is not covered by `.gitignore` yet; it is deliberately
  left uncommitted (see `docs/dependency-requests/agent-d-ci.md`).

## Repro

```
node scripts/ci/repeatability-rounds.mjs   # exit 0 iff all rounds PASS, 0 flakes, clean residuals
npm run typecheck                          # PASS
npm run security-scan                      # clean
```
