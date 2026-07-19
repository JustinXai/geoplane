# LOCAL DATABASE AUDIT — FIRST READ-ONLY REVIEW

Audit scope: first-round static safety review of database selection, destructive operations, backup, and restore.

Decision: **BLOCKED**

`REMOTE_WRITE_ATTEMPTS = 0`

## Snapshot

`main`, `local/environment-runtime-v1`, `local/recovery-drill-v1`, and `local/closed-pilot-staging-v1` all pointed to `cfb230f1565600ae95c2fd1b78ee92086b498095`. The environment and recovery workstreams therefore had no committed implementation to review at this snapshot.

| Required item | First-round result |
| --- | --- |
| Runtime database exactly `geoplane_local_runtime` | BLOCKED — no committed local environment implementation |
| Test database exactly `geoplane_local_test` | STATIC containment exists only in functional runner; dynamic result NOT_VERIFIED |
| Canary database exactly `geoplane_local_canary` | BLOCKED — no committed local environment implementation |
| Restore target exactly `geoplane_local_restore_verify` | BLOCKED — no committed local recovery wrapper |
| All four targets loopback-only and mutually isolated | BLOCKED |
| Migrations `0001` through `0008` | Eight tracked migration files exist; applied state NOT_VERIFIED |
| Database connectivity | NOT_VERIFIED |
| Table count | NOT_VERIFIED |
| Runtime persistence after restart | NOT_VERIFIED |
| Real backup and checksum | NOT_VERIFIED |
| Restore and required business-row readback | NOT_VERIFIED |

## Blocking findings

### DB-01 — Generic runtime/test configuration has no destructive test guard

Severity: CRITICAL

`src/persistence/config.ts:85-87` selects `GEO_TEST_DATABASE_URL` for tests but validates neither the host nor database name. DB-backed tests contain broad `TRUNCATE ... CASCADE` statements. Running the general test command with a misconfigured test URL can therefore clear whatever database that URL names.

The new functional runner mitigates this only for its own child test: `scripts/local/functional-pilot.mjs:88-118` requires the exact loopback `geoplane_local_test` target before spawning Vitest. That does not protect `npm test` or other direct DB test entry points.

Required change: place a reusable fail-closed exact-purpose guard at every destructive test entry point (or centrally before DB test setup), not only in the functional runner.

### DB-02 — Existing database-purpose preflight is broader than the local-stage contract

Severity: HIGH

`scripts/preflight/database-environment.mjs:93-106` accepts any test name containing `test`, any canary name containing `canary`, and a runtime name that merely omits those tokens. It does not require the exact `geoplane_local_*` names or a loopback host. It only explicitly compares the canary target against runtime/test; it does not impose the complete four-target local topology required for this stage.

The tracked `.env.example` also still documents legacy names (`geoplane_runtime`, `geoplane_runtime_test`, `geoplane_canary`), not the fixed local-stage names.

### DB-03 — Generic restore can overwrite the runtime database

Severity: CRITICAL

`scripts/backup/restore.mjs:95-136` refuses only names matching a broad production/recovery token pattern. `geoplane_local_runtime` is not protected by that pattern. With `--force`, the script can run `pg_restore --clean` against a populated runtime database. This violates the stage requirement that restore verification target only a fresh `geoplane_local_restore_verify` database and never clear runtime.

Required change: add a stage wrapper that accepts exactly the restore-verification database, requires loopback and source/target separation, refuses runtime/test/canary targets at the final destructive call site, verifies the archive checksum before restore, and does not expose a force path that can target runtime.

### DB-04 — Existing backup/restore E2E is not the required recovery drill

Severity: HIGH

The existing test creates random throwaway source/destination databases and verifies a subset of tenancy, knowledge, opportunity, delivery, and audit data. It does not prove backup of `geoplane_local_runtime`, restore into exactly `geoplane_local_restore_verify`, or readback of the full required inventory (accounts, memberships, EnterpriseProfile, KeywordQuestionMap, Human Review, Article, Delivery, AuditEvent, Provider Ledger). The recovery branch had no committed delta, so the required drill is **BLOCKED**.

### DB-05 — Full database separation is not required by the functional runner

Severity: MEDIUM

The functional runner exactly protects its destructive test target and rejects a configured runtime/canary alias. However, runtime and canary URLs are optional in that runner, so it does not prove the complete three-database environment exists or is mutually isolated. That proof belongs in the missing local environment preflight.

## Safe static observations

- The functional runner compares database targets by host, port, and decoded database name without printing credentials.
- Its child environment forces Provider OFF and the post-run query requires zero `provider_execution` rows in the isolated test database.
- The existing backup tool passes the password through the child environment rather than the command line and prints only database host/port/name and artifact path.
- The generic restore validates SQL identifiers and refuses obvious production/recovery names, but those controls are insufficient for this fixed local-stage topology.
- No database command was run during this audit. Database state, applied migrations, persistence, checksums, and row counts are all **NOT_VERIFIED**.

## Required disposition

Database readiness remains **BLOCKED** until the exact local topology and lifecycle wrappers are committed, destructive test and restore call sites fail closed, and the live database/restart/backup/restore gates run successfully with non-secret evidence.
