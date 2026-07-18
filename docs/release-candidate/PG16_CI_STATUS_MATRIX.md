# PG16_CI_STATUS_MATRIX — PG16_CI_SUPERVISOR_AUDIT_V1

- Phase: `AUTOMATED_PG16_RELEASE_GATE_V1` · Supervisor branch: `audit/pg16-ci-supervisor-v1`
- Audited tree: `cf6617d7955bbfd6bd3e8c1bd71fecf983072482` (integration/closed-pilot-rc-ci-v1) —
  byte-identical to the head_sha of the certified run.
- Companion audits: `PG16_CI_SECURITY_AUDIT.md` (items 3–5), `PG16_CI_DATABASE_AUDIT.md`
  (items 1, 2, 6–9), `PG16_CI_EVIDENCE_AUDIT.md` (item 10 + evidence integrity).
- Verification method for run facts: unauthenticated GitHub REST API on the public repo
  (`/repos/JustinXai/geoplane/actions/runs/...`); no credential used, artifact bodies and job logs
  therefore not re-read (401/403) — see the by-construction proof note below the matrix.

## Run identity (observed)

| Field | Run 1 | Run 2 | Run 3 (certified) |
| --- | --- | --- | --- |
| Run ID | 29653317508 | 29653788253 | **29654550660** |
| URL | github.com/JustinXai/geoplane/actions/runs/29653317508 | …/actions/runs/29653788253 | **…/actions/runs/29654550660** |
| run_number / attempt | 1 / 1 | 2 / 1 | 3 / 1 |
| head_sha | f5bfe6c | bb7d1b6 | **cf6617d** (== audited tree) |
| Trigger | push integration/closed-pilot-rc-ci-v1 | push (same) | push (same) |
| Conclusion | failure | failure | **success** |
| static-gates | success | success | success (17:45:59→17:46:59Z) |
| postgres16-gates | **failure** @ step `Create isolated CI databases` | **failure** @ step `Run database gates` | success (17:47:02→17:48:00Z) |
| backup-restore-gates | skipped | skipped | success (17:48:02→17:48:45Z) |
| Artifacts | — | — | database-gates-evidence (8432481144), postgres16-gate-evidence (8432488411), both unexpired |

## The two failed-run diagnoses (verified against API + git)

1. **Run 1 → CI_CONFIGURATION_ERROR, fix attempt 1/2 = `bb7d1b6`.** Failed step confirmed via API:
   `Create isolated CI databases`. Cause: `GEO_CI_ADMIN_URL` pointed at `geoplane_ci_runtime`, which
   collided with a CI database name and correctly tripped the script's own guard
   (`create-isolated-databases.mjs:152-157`, `CI_DB_GATE_PURPOSE_MISMATCH` — "a CI database name
   collides with the admin maintenance database"). Fix: admin URL now targets the `postgres`
   maintenance DB (workflow lines 100, 173). The diff touches only those two env values — **the guard
   itself is untouched and did its job.**
2. **Run 2 → BACKUP_FAILURE, fix attempt 1/2 = `cf6617d`.** Failed step confirmed via API:
   `Run database gates` (where the pilot vitest suites run; 25/28 gates already PASS on PG16 per the
   commit record). Cause: the pilot suites' backup/restore drills spawned the backup/restore CLIs with
   a hardcoded `--user postgres`, but the CI container's superuser is `geoplane_ci`
   (pg_dump auth failure). Fix: `SUPERUSER` is now read from `GEO_PG_SUPERUSER` (default `postgres`;
   CI injects `geoplane_ci`, workflow lines 103, 176). **Diff adds no/removes no assertion** —
   role-name parameterization only (full-diff verified).

Both classes consumed **1 of their 2 allowed attempts** under
`CI_FAILURE_RECOVERY_MATRIX.md` (max-2-then-ROOT_CAUSE_MODE); no forbidden response
(test deletion/skip, soft-fail, rerun-until-green, scanner weakening) appears anywhere in the fixes.

## Gate matrix (run 29654550660)

Status source: job conclusions from the REST API + the hard-fail construction of
`generate-ci-evidence.mjs` (exits non-zero on any FAIL/NOT_RUN gate, on `providerRuntimeEnabled=true`,
or on `realProviderCallsExecutedByCI != 0`) — job 3 succeeded, therefore every row below held.

| # | Gate | Job | Status | Note |
| --- | --- | --- | --- | --- |
| 1 | Typecheck | static-gates | PASS | job success |
| 2 | Security scan | static-gates | PASS | job success |
| 3 | Repo safety preflight | static-gates | PASS | job success |
| 4 | Build web | static-gates | PASS | job success |
| 5 | PostgreSQL 16 strict verify (`SELECT version()` major == 16) | postgres16-gates | PASS | image name never used as evidence |
| 6 | migrations (0001–0008, all three CI DBs, ledger re-queried) | postgres16-gates | PASS | migrationCount 8 corroborated from `migrations/` |
| 7 | manifest | postgres16-gates | PASS | |
| 8 | purposePreflight (DatabaseEnvironmentPreflightV1, 3 roles) | postgres16-gates | PASS | refuses superuser + purpose mismatch |
| 9 | readiness (ledger vs manifest floor, per DB) | postgres16-gates | PASS | |
| 10 | constraints (blank email + invalid org type rejected) | postgres16-gates | PASS | |
| 11 | triggers (knowledge_content UPDATE/DELETE rejected) | postgres16-gates | PASS | |
| 12 | appendOnly (provider_execution UPDATE/DELETE rejected) | postgres16-gates | PASS | |
| 13 | providerLedger (2 dedicated pg suites incl. identity migration) | postgres16-gates | PASS | |
| 14 | concurrentIdempotency | postgres16-gates | PASS | |
| 15 | tenantIsolation (4 suites, full-pass required) | postgres16-gates | PASS | suites untouched by the delta |
| 16 | agencyIsolation | postgres16-gates | PASS | |
| 17 | restartE2E | postgres16-gates | PASS | |
| 18 | sessionRotationE2E | postgres16-gates | PASS | |
| 19 | closedPilotE2E (runs last; leaves sanitized data set) | postgres16-gates | PASS | |
| 20 | pg_dump/pg_restore client major == 16 | backup-restore-gates | PASS | grep-asserted before use |
| 21 | migrations re-applied on fresh job-3 DBs (app role) | backup-restore-gates | PASS | |
| 22 | backup + sha256 re-hash verification | backup-restore-gates | PASS | seeded sanitized data (fresh DBs) |
| 23 | restore into fresh guarded DB + SQL read-back (counts, knowledge hashes, provider identity gateway_vendor/model_vendor/protocol, append-only post-restore) | backup-restore-gates | PASS | restore=PASS requires read-back PASS |
| 24 | Evidence merge (no NOT_RUN, artifact chain job2→job3) | backup-restore-gates | PASS | both artifacts present, unexpired |
| 25 | providerRuntimeEnabled == false | all jobs | PASS | flag "false" workflow-wide + per job + re-forced + re-checked |
| 26 | realProviderCallsExecutedByCI == 0 (per-DB 0/0/0) | evidence | PASS | independently recomputed across the 3 CI DBs; unverifiable = failure |
| 27 | No secrets context / no provider key / throwaway creds only | workflow | PASS | zero `${{ }}` expressions in the workflow |
| 28 | Canary unreachable (RUN_PROVIDER_CANARY never set; skipIf gate) | workflow + tests | PASS | canary suite not even in the CI suite lists |

## Supervisor findings summary

- **REAL violations: 0.**
- **Minor recommendations (non-blocking):**
  1. Add `postgres16-verify.mjs` to job 3 so its own service container's server version is also
     SQL-asserted (today: image pin + client-16 assertions only) — `PG16_CI_DATABASE_AUDIT.md` item 1.
  2. Reconcile `POSTGRES16_REMOTE_CI_REPORT.md` row "Full test suite (npm test)" (Job 1 doesn't run
     `npm test`; DB suites run in job 2) and its stale branch reference when transcribing results —
     `PG16_CI_EVIDENCE_AUDIT.md` observation 3.
  3. Residual documented design note: `geoplane_runtime` is intentionally outside
     `PRODUCTION_DB_PATTERN`; CI safety for that name rests on verified localhost-only isolation.
- **Honest-scope note:** evidence-artifact bodies were not re-read (unauthenticated 401/403; this
  audit uses no credential). All PASS/invariant claims above are proven by job success plus the
  hard-fail construction of the scripts at the exact audited SHA; the decorative reported values
  (`PostgreSQL 16.14…`, constraintCount 294, triggerCount 24) are consistent but not independently
  re-derived, and gate nothing.

## Overall Supervisor verdict

**PASS_WITH_CHANGES.**

The PG16 release gate is genuinely green on canonical PostgreSQL 16 with zero real violations — but
green was reached *with changes during the phase*: two verified, non-weakening fixes (`bb7d1b6`
config-only, `cf6617d` role-name parameterization only) after two honestly-diagnosed failed runs,
each within the max-2-attempts discipline. The three minor recommendations above are follow-ups, not
blockers. Checklist items A6/E1 may now be closed by Agent E from run 29654550660 per the transcription
rules in `POSTGRES16_REMOTE_CI_REPORT.md`; the six HUMAN_PENDING items remain with their named humans.
