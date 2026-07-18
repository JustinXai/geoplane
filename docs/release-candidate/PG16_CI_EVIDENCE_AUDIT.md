# PG16_CI_EVIDENCE_AUDIT — PG16_CI_SUPERVISOR_AUDIT_V1

- Phase: `AUTOMATED_PG16_RELEASE_GATE_V1` · Supervisor branch: `audit/pg16-ci-supervisor-v1`
- Audited tree: `cf6617d7955bbfd6bd3e8c1bd71fecf983072482` == head_sha of green run 29654550660.
- Scope: checklist item 10 + evidence-JSON integrity (field completeness, NOT_RUN semantics, the
  job2→job3 artifact chain).

## Item 10a — no fixture reintroduction: **PASS**

The entire integration delta audited here (`c7c2ab4..cf6617d`, 17 files) touches **no `src/`, no
`migrations/`** — only the new workflow, `.gitignore`, docs, the five new `scripts/ci/*.mjs`, and a
2-file test change (below). The gate/backup scripts create data only in the three throwaway CI
databases, and only sanitized fixture rows: `run-backup-restore-gate.mjs:118-168` seeds reserved test
domains (`…@example.test`), explicit `(Pilot Fixture)` markers, and provider rows whose model is the
offline marker `'offline-deterministic'` with a comment stating the evidence counter excludes nothing
real because nothing real exists. No previously-removed fixture path returns anywhere in the diff.

## Item 10b — no weakened tenant-isolation (or any) tests: **PASS**

- The only test-file change in the whole delta is commit `cf6617d`
  (`tests/pilot/closed-pilot-operations.e2e.pg.test.ts`, `tests/pilot/pilot-resilience.e2e.pg.test.ts`):
  `const SUPERUSER = "postgres"` → `const SUPERUSER = process.env.GEO_PG_SUPERUSER?.trim() || "postgres"`
  plus a 3-line comment. This parameterizes the superuser **role name** used by the backup/restore
  drills (`--user SUPERUSER` into the real CLIs; admin read-back connections). Default unchanged
  (`postgres`), CI injects `geoplane_ci` (workflow lines 103, 176). **Zero assertions were added,
  removed, or altered** — verified on the full diff.
- Tenant-isolation suites (`tests/persistence/pg-tenancy-runtime.pg.test.ts`,
  `pg-tenancy-b2.pg.test.ts`, `tests/e2e/*`) are untouched by the delta and are *required to fully
  pass* by the `tenantIsolation` gate (`run-database-gates.mjs:292-300`), where a skipped or missing
  test maps to NOT_RUN, never PASS.
- The other two fixes were config-only: `bb7d1b6` changes one env URL's database segment
  (`geoplane_ci_runtime` → `postgres` maintenance DB, twice); `f5bfe6c` adds artifact upload/download
  steps, job-3 migrate steps, and dedupes a `.gitignore` line. No `continue-on-error`, no soft-fail,
  no skip, no scanner change anywhere in the three commits.

## Item 10c — no NOT_RUN recorded as PASS: **PASS**

Enforced by code, not convention:

- `generate-ci-evidence.mjs:90-97` — any gate absent from job 2's record defaults to **NOT_RUN**;
  `:199-201` the step **exits non-zero when any gate is FAIL *or NOT_RUN*** ("an unproven gate cannot
  certify a release", `:16-18`).
- `:101-109` — `restore` reads PASS **only** when the restore step *and* its SQL read-back both PASS;
  a restore whose read-back failed is FAIL, and only both-NOT_RUN yields NOT_RUN.
- `run-database-gates.mjs:144-149` (`evaluateTestSelection`) — failed ⇒ FAIL; missing ⇒ NOT_RUN;
  **skipped or zero-passed ⇒ NOT_RUN**; PASS requires every matched test to have genuinely passed.
  `:492-494` — zero total tests is a hard failure (`CI_DB_GATE_NO_TESTS_RAN`).
- Docs hold the same line: `POSTGRES16_REMOTE_CI_REPORT.md` has **every** result field
  `PENDING_REMOTE_CI` (rule 1, lines 12–17: "NOT_RUN is never recorded as PASS");
  `CLOSED_PILOT_RELEASE_CHECKLIST.md` keeps A6/E1 `PENDING_REMOTE_CI`;
  `OVERNIGHT_PG16_CI_PROGRESS.md` records the workflow as "Authored + validated ONLY — not executed,
  no PASS claimed" at its checkpoint. No pre-recorded PASS exists anywhere.

## Evidence-JSON integrity

### Fields match the spec list: **PASS**

`generate-ci-evidence.mjs:137-169` emits exactly the contract set: `checkpoint`, `phase`,
`generatedAt`, `runStartedAt`; canonical facts `postgresVersion`, `migrationCount`, `tableCount`,
`constraintCount`, `triggerCount`; the three database names; the flat gate statuses
(`tenantIsolation`, `agencyIsolation`, `providerLedger`, `backup`, `restore`, `restartE2E`,
`sessionRotationE2E`, `closedPilotE2E`); the provider-safety invariants (`providerRuntimeEnabled`,
`realProviderCallsExecutedByCI`, `perDatabaseRealCalls`); and the full per-gate detail
(`gates` — all 14 names from `GATE_NAMES` at `:35-50` — plus `backupRestore`, `vitest`).
The 14 gate names cover every gate row in `POSTGRES16_REMOTE_CI_REPORT.md` jobs 2–3.

### NOT_RUN semantics: **PASS** — see item 10c; both producers and the merger treat absence/skip as
NOT_RUN and the merger refuses to certify with any NOT_RUN present.

### Artifact chain job2 → job3: **PASS**

- Job 2 writes `artifacts/ci/database-gates.json` and uploads it as artifact
  `database-gates-evidence` with `if-no-files-found: error` (workflow lines 144–149).
- Job 3 downloads that artifact into `artifacts/ci` (lines 243–247) **before** `Generate CI evidence`
  (249–250), which merges it with job 3's own `backup-restore.json` and uploads the combined
  `postgres16-gate.json` as `postgres16-gate-evidence`, again `if-no-files-found: error` (252–257).
- Chain closure by design: had the download step been missing/failed, `generate-ci-evidence` would
  have reported all 14 gates NOT_RUN and **exited non-zero** — this is precisely the failure mode
  commit `f5bfe6c` fixed *forward* (by adding the handoff), not by weakening the check.
- Observed run 29654550660 has **both artifacts present and unexpired**
  (`database-gates-evidence` id 8432481144, `postgres16-gate-evidence` id 8432488411 — REST
  `/actions/runs/29654550660/artifacts`), and job 3 succeeded ⇒ the merge ran against job 2's real
  record from the same run.
- Integrity note: within one workflow run, GitHub artifact names are unique and job 3 `needs:
  postgres16-gates`, so the downloaded file can only be the one job 2 of this run uploaded.

### Honest-scope observations (no violation; reconcile when results are transcribed)

1. **Artifact content not independently re-read:** unauthenticated artifact download returns HTTP 401
   and job logs 403 (this audit uses no credential, per its own rules). The load-bearing claims are
   nevertheless proven by construction: job-3 success ⇒ `generate-ci-evidence` exited 0 ⇒ all 14
   gates PASS, backup PASS, restore PASS, `providerRuntimeEnabled=false`,
   `realProviderCallsExecutedByCI=0`. `migrationCount 8` and `tableCount 42` are additionally
   corroborated statically from `migrations/`. The exact strings/counts `PostgreSQL 16.14…`,
   `constraintCount 294`, `triggerCount 24` are consistent reported values without independent
   re-derivation — none of them gates anything.
2. **`perDatabaseRealCalls` scope:** the three databases counted are job 3's (job 2's container dies
   with its job). Job 2's zero-call guarantee is enforced by its own verified chain (flag forced
   false, key deleted unread, canary unschedulable) — see `PG16_CI_SECURITY_AUDIT.md` item 5.
3. **Doc drift to fix at transcription time:** `POSTGRES16_REMOTE_CI_REPORT.md:59` lists
   "Full test suite (`npm test`)" under Job 1, but the executed static-gates job runs
   typecheck / security-scan / repo-safety-preflight / build only (the DB-backed suites run in job 2
   via `run-database-gates.mjs`); and the report's run-identity table still names branch
   `ci/postgres16-release-gate-v1` while the observed run was triggered on
   `integration/closed-pilot-rc-ci-v1`. Agent E/A should reconcile these rows when filling results —
   both fields are currently (honestly) `PENDING_REMOTE_CI`.

## Verdict (this document)

**PASS — 0 real violations.** Fixture hygiene intact, no test weakened, NOT_RUN can never surface as
PASS, evidence fields complete per contract, artifact chain sound and observed intact on the green run.
