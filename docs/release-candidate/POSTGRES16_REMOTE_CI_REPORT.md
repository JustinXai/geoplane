# POSTGRES16_REMOTE_CI_REPORT — AUTOMATED_PG16_RELEASE_GATE_V1

- Phase: `AUTOMATED_PG16_RELEASE_GATE_V1` / checkpoint `CLOSED_PILOT_RELEASE_EVIDENCE_V1` (Agent E)
- Branch: `ops/release-evidence-v1` (baseline `c7c2ab4`, docs only)
- Workflow under evidence: `.github/workflows/closed-pilot-postgres16.yml` — authored in the
  parallel lane on branch `ci/postgres16-release-gate-v1` (Agent A). At the time this report was
  written the workflow has **NOT been executed**.
- Date: 2026-07-19

## Reporting rules (binding)

1. **NOT_RUN is never recorded as PASS.** Every result field below reads `PENDING_REMOTE_CI`
   until a real GitHub Actions run has been directly observed. This mirrors the standing
   discipline of this repository: the local PG16 attempt was honestly recorded as
   `BLOCKED_PENDING_ENV` (`docs/release-candidate/POSTGRES16_ENVIRONMENT_ATTEMPT.md:4`) and the
   supervisor verified that **no false PG16 PASS exists anywhere in the tree**
   (`docs/release-candidate/POSTGRES16_COMPATIBILITY_AUDIT.md`). This report continues that rule.
2. **Only Agent A fills in results, and only from an observed run.** Result fields are updated
   exclusively from the concrete workflow run (run ID + URL + per-job conclusions read from the
   GitHub Actions UI/API), never from expectation, extrapolation, or a local re-run.
3. **The verified PostgreSQL version must come from the database itself** — the workflow must
   capture `SELECT version()` output from inside the job's service container. The container image
   name (`postgres:16*`) is recorded separately and is NOT acceptable as version evidence.
4. **PG18-equivalent evidence never substitutes for a PG16 result.** The local PG18 battery
   (`PG18_EQUIVALENT = PASS (6/6)`, `docs/pilot/BACKUP_RESTORE_NOTES.md`) remains labelled PG18
   and closes nothing in this report.
5. **No real provider call may occur in CI.** The workflow must run with the provider runtime OFF
   and without any provider key in secrets/env. See the provider posture block below.

## Run identity

| Field | Value |
| --- | --- |
| Workflow file | `.github/workflows/closed-pilot-postgres16.yml` (branch `ci/postgres16-release-gate-v1`) |
| Workflow Run ID | PENDING_REMOTE_CI |
| Workflow Run URL | PENDING_REMOTE_CI |
| Workflow Conclusion | PENDING_REMOTE_CI |
| Commit SHA exercised by the run | PENDING_REMOTE_CI |
| PostgreSQL Image (service container tag) | PENDING_REMOTE_CI |
| VERIFIED PostgreSQL Version (from `SELECT version()`, never the image name) | PENDING_REMOTE_CI |

## Provider posture in CI (must hold in the observed run)

| Field | Required value | Observed |
| --- | --- | --- |
| Provider Runtime Enabled (`PROVIDER_RUNTIME_ENABLED`) | must be `false` (or unset — default-OFF per `src/runtime/provider/feature-flag.ts`) | PENDING_REMOTE_CI |
| Provider Key Present In CI (`DEEPSEEK_API_KEY` in secrets/env) | must be **NO** | PENDING_REMOTE_CI |
| Real Provider Calls Executed By CI | must be **0** (the canary suite is `describe.skipIf`-gated and `RUN_PROVIDER_CANARY` is never set in CI) | PENDING_REMOTE_CI |

If any of the three observed values deviates from its required value, the run is a
`SECURITY_GATE_FAILURE` regardless of job conclusions (see
`docs/release-candidate/CI_FAILURE_RECOVERY_MATRIX.md`).

## Job 1 — static-gates

| Gate | Result |
| --- | --- |
| Typecheck (`npm run typecheck`) | PENDING_REMOTE_CI |
| Full test suite (`npm test`; canary skip-gated by design) | PENDING_REMOTE_CI |
| Production build (`npm run build:web`) | PENDING_REMOTE_CI |
| Security scan (`npm run security-scan`) | PENDING_REMOTE_CI |
| Repo safety preflight (`npm run repo:safety:preflight`) | PENDING_REMOTE_CI |

## Job 2 — postgres16-gates (against the postgres:16 service container)

| Gate | Result |
| --- | --- |
| Migrations 0001–0008 fresh-apply (`scripts/db/migrate.mjs`) | PENDING_REMOTE_CI |
| Migration manifest verify (`migrations/manifest.json` frontier consistent with applied set) | PENDING_REMOTE_CI |
| Database purpose preflight (`DatabaseEnvironmentPreflightV1` role/purpose checks) | PENDING_REMOTE_CI |
| Constraint verify (CHECK/FK/NOT NULL battery) | PENDING_REMOTE_CI |
| Trigger verify (history-table triggers present and firing) | PENDING_REMOTE_CI |
| Append-only verify (UPDATE/DELETE rejected on history tables incl. `provider_execution`) | PENDING_REMOTE_CI |
| Provider ledger + identity metadata (whitelisted column set; `gateway_vendor` / `model_vendor` / `protocol` closed CHECK sets; no secret/host/content column) | PENDING_REMOTE_CI |
| Concurrent idempotency (re-migrate applies 0; duplicate idempotency key yields exactly one row) | PENDING_REMOTE_CI |
| Tenant isolation (cross-client 403 + empty-own-view control) | PENDING_REMOTE_CI |
| Agency assignment isolation (agency sees only ACTIVE-assigned clients) | PENDING_REMOTE_CI |
| Restart E2E (pool restart / `pg_terminate_backend` self-heal + durable read-back) | PENDING_REMOTE_CI |
| Session rotation E2E (K1→K2 window honored; old cookie rejected after retirement; re-login OK) | PENDING_REMOTE_CI |
| Closed pilot role E2E (sanitized 3-role chain over real route handlers; 401/403 per hop) | PENDING_REMOTE_CI |

## Job 3 — backup-restore-gates (against the postgres:16 service container)

| Gate | Result |
| --- | --- |
| Backup (`scripts/backup/backup.mjs` custom-format dump) | PENDING_REMOTE_CI |
| Checksum (sha256 recorded and re-verified for the dump artifact) | PENDING_REMOTE_CI |
| Restore (`scripts/backup/restore.mjs` into a FRESH database) | PENDING_REMOTE_CI |
| Read-back (restored business rows + append-only triggers verified in the restored DB) | PENDING_REMOTE_CI |

## Standing local evidence this report does NOT count as PG16

For context only — all of the following are PG18-labelled or environment-blocked, and none closes
any field above:

- `docs/release-candidate/POSTGRES16_ENVIRONMENT_ATTEMPT.md` — local PG16 attempt,
  `BLOCKED_PENDING_ENV` (WSL2/Docker unstartable; no PG16 binaries; host runs PostgreSQL 18.3).
- `docs/pilot/BACKUP_RESTORE_NOTES.md` — `CANONICAL_POSTGRES16_VERIFY = BLOCKED_PENDING_ENV`;
  `PG18_EQUIVALENT = PASS`.
- `docs/release-candidate/OVERNIGHT_CLOSED_PILOT_RC_REPORT.md` — release decision
  `CLOSED_PILOT_RC_PENDING_PG16`; the exact next action is this remote CI gate.

## Completion criterion

This report is complete when every `PENDING_REMOTE_CI` field above has been replaced by Agent A
with a value read from one specific observed workflow run (single Run ID/URL for all fields), the
three provider-posture fields hold their required values, and the VERIFIED PostgreSQL Version
field carries `SELECT version()` output beginning `PostgreSQL 16.`.
