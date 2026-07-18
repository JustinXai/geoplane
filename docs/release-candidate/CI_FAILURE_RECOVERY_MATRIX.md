# CI_FAILURE_RECOVERY_MATRIX — AUTOMATED_PG16_RELEASE_GATE_V1

- Phase: `AUTOMATED_PG16_RELEASE_GATE_V1` / checkpoint `CLOSED_PILOT_RELEASE_EVIDENCE_V1` (Agent E)
- Applies to: `.github/workflows/closed-pilot-postgres16.yml` (branch `ci/postgres16-release-gate-v1`)
  and its three jobs (static-gates / postgres16-gates / backup-restore-gates)
- Companion: `docs/release-candidate/POSTGRES16_REMOTE_CI_REPORT.md` (results),
  `docs/pilot/PILOT_FAILURE_RECOVERY_MATRIX.md` (runtime-pilot failures — a distinct scope)
- Date: 2026-07-19

## Global rules (apply to every failure class)

1. **Max attempts = 2, then ROOT_CAUSE_MODE.** At most two fix attempts per distinct failure. If
   the second attempt does not turn the gate green, STOP changing things: enter ROOT_CAUSE_MODE —
   collect the full job log, the exact failing step, the exact error text, and the diff of every
   attempted fix; write the analysis down (this directory) and escalate to a human decision.
   No third patch attempt, no speculative re-run.
2. **Forbidden responses — always, for every class:**
   - Deleting, weakening, or `skip`/`todo`-ing a failing test to make CI green.
   - Skipping PG16 or substituting another PostgreSQL major (e.g. PG18) for the PG16 gate.
     PG18-labelled evidence never closes a PG16 field (see the standing rule verified in
     `POSTGRES16_COMPATIBILITY_AUDIT.md`).
   - Disabling security scans, preflights, constraints, or append-only triggers.
   - Rerun-until-green: re-running an unchanged workflow hoping for a different outcome. One
     re-run is legitimate ONLY when a specific transient cause has been identified and named
     (e.g. runner network outage) — and it counts as one of the 2 attempts.
   - Adding a provider key to CI, enabling `PROVIDER_RUNTIME_ENABLED`, or making any real
     provider call to "unblock" anything.
   - Editing an already-shipped migration file.
3. **Evidence discipline:** every attempt (1st and 2nd) is recorded with run URL, failing step,
   error text, and the fix diff. `POSTGRES16_REMOTE_CI_REPORT.md` fields stay PENDING_REMOTE_CI
   until a fully observed green run exists; a partially green run closes nothing.

## Per-class matrix

| Failure class | Symptom | First diagnostic step | Allowed fix scope | Forbidden responses (in addition to global) | Max attempts |
| --- | --- | --- | --- | --- | --- |
| CI_CONFIGURATION_ERROR | Workflow fails before any gate runs: YAML parse error, unknown action, missing `env`, wrong working directory, job dependency cycle, checkout of the wrong ref | Read the workflow-parse/step-setup section of the run log; reproduce the YAML lint locally; confirm the ref/branch the run checked out | The workflow YAML itself (steps, env wiring, service definitions, job order) on `ci/postgres16-release-gate-v1`. No product code, no tests, no migrations | Hard-coding gate results in YAML; `continue-on-error` on a gate step; removing a gate step to make the workflow parse | 2, then ROOT_CAUSE_MODE |
| POSTGRES16_STARTUP_ERROR | The postgres:16 service container never becomes healthy: health-check timeout, auth failure to the service, port not reachable from job steps | Pull the service-container log from the run; check image tag, health-check command/interval, and the env the container was given (user/password/db) | Service-container configuration in the workflow (image tag within PG16 minors, health check, ports, container env, wait-for-ready step) | Switching the image to a non-16 major; pointing gates at any database other than the job's PG16 service; masking startup by sleeping instead of health-checking | 2, then ROOT_CAUSE_MODE |
| MIGRATION_FAILURE | `scripts/db/migrate.mjs` exits non-zero on PG16: SQL error in 0001–0008 apply, manifest mismatch, wrong apply order | Identify the exact migration file + statement from the error; run the same migration sequence against a local throwaway DB to reproduce; diff PG16 vs PG18 behavior for the failing statement | Genuine PG16-incompatibility fixes only, as a NEW forward migration or a reviewed correction, preserving semantics; manifest updated in lockstep. Requires human review before merge | Editing shipped migration files in place; dropping/reordering migrations; relaxing a constraint to make apply succeed; running against PG18 and calling it done | 2, then ROOT_CAUSE_MODE |
| CONSTRAINT_FAILURE | Constraint/trigger verify gates fail: an expected CHECK/FK/NOT NULL rejection does not occur on PG16, or an unexpected rejection breaks a legitimate insert | Extract the exact constraint name + statement from the test output; reproduce the single statement via psql against the job's schema; compare `information_schema` between expectation and the PG16 DB | Test-harness fixes if the expectation is wrong (with proof); otherwise a reviewed schema fix as a new migration. Semantics (no-silent-approve, append-only, closed enums) must be preserved exactly | Dropping or loosening the constraint; disabling the trigger; catching-and-ignoring the DB error in the harness | 2, then ROOT_CAUSE_MODE |
| TEST_ISOLATION_FAILURE | Gates pass alone but fail together: cross-suite data bleed, TRUNCATE races, duplicate fixture keys, order-dependent failures in the PG16 job | Re-run the failing suite in isolation in the same job to confirm order-dependence; identify which prior suite leaves the offending rows/state | Test setup/teardown and fixture scoping only (unique keys per suite, proper TRUNCATE lists, serialized DB-backed suites). No product code changes for an isolation symptom | Splitting the job just to hide the interaction; deleting the colliding test; retry loops around flaky assertions | 2, then ROOT_CAUSE_MODE |
| BACKUP_FAILURE | `scripts/backup/backup.mjs` fails in the backup-restore-gates job: pg_dump error, missing client tools, checksum not produced, refused database name | Read the exact pg_dump/stderr line; verify the job installed matching PostgreSQL client tools; verify the target DB name does not hit the production/recovery guard (by design it refuses `prod`/`live`/`recover*` names) | Job tooling setup (client-tools install/version), artifact paths, and backup invocation flags in the workflow | Bypassing the production/recovery name guard; skipping the checksum step; dumping with a mismatched-major pg_dump and ignoring the version warning | 2, then ROOT_CAUSE_MODE |
| RESTORE_FAILURE | `scripts/backup/restore.mjs` fails: target create fails, pg_restore errors, object counts short after restore | Read the first pg_restore error (later errors usually cascade); confirm the restore user can CREATE DATABASE in the job's service (locally this required `--user postgres` — a known, documented behavior, see `OVERNIGHT_RC_PROGRESS.md` checkpoint 3); confirm the target is FRESH | Restore invocation (user/flags/target naming) and job DB-privilege setup. The restore-to-FRESH rule stays: never restore over a populated DB without the explicit `--force` design path | Using `--force` to paper over a failed create; restoring into the gate's primary test DB; accepting a restore with short object counts as PASS | 2, then ROOT_CAUSE_MODE |
| APPLICATION_BUILD_FAILURE | `npm run build:web` or `npm run typecheck` fails in CI while green locally: dependency install drift, Node-version mismatch, OOM on the runner | Compare the CI Node version + lockfile install log against the local green environment; reproduce with a clean `npm ci` locally | CI environment pinning (Node version, `npm ci` from the committed lockfile, runner resources). Product-code fixes only for a real defect the build legitimately caught, reviewed as a normal change | Publishing/deploying anything from a red build; `--force`/`--legacy-peer-deps` installs to mask a lockfile conflict; downgrading the typechecker or excluding files from typecheck | 2, then ROOT_CAUSE_MODE |
| SECURITY_GATE_FAILURE | `security-scan` / `repo:safety:preflight` reports a hit in CI; OR a provider-posture violation is observed (provider key present in CI, `PROVIDER_RUNTIME_ENABLED` true, or any real provider call from CI) | Identify the exact file/line/pattern from the scanner output; classify: real secret vs. false-positive prose (precedent: commit `9e56035` cleared a Bearer-header prose false positive by rewording, never by weakening the scanner) | Real secret: remove it, rotate the credential out-of-band, and treat the branch history as contaminated (human decision on history rewrite). False positive: reword the offending prose. Posture violation: remove the key/flag from CI config immediately | Weakening or disabling the scanner; allowlisting a real secret; leaving a provider key in CI "because the job needs it" (no CI job ever needs it — required posture: key present NO, real calls 0) | 2, then ROOT_CAUSE_MODE (a REAL secret hit is immediate ROOT_CAUSE_MODE — attempt count does not apply to credential rotation) |

## ROOT_CAUSE_MODE definition

Entered after the 2nd failed attempt on any class (immediately on a real secret exposure).
In ROOT_CAUSE_MODE:

1. Freeze the failing workflow/branch — no further fix commits.
2. Produce a written root-cause note in `docs/release-candidate/` containing: run URLs of all
   attempts, exact failing step + verbatim error, the diff of each attempt, and the current
   hypothesis with what evidence would confirm or refute it.
3. Escalate to the human release owner (checklist item H3 in
   `CLOSED_PILOT_RELEASE_CHECKLIST.md`); the release stays NO-GO and every affected report field
   stays PENDING_REMOTE_CI until the root cause is confirmed and a reviewed fix lands.
