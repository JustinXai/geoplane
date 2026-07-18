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
| Workflow Run ID | 29654550660 (successful gate run; prior runs 29653317508 / 29653788253 diagnosed below) |
| Workflow Run URL | https://github.com/JustinXai/geoplane/actions/runs/29654550660 |
| Workflow Conclusion | success (all 3 jobs: static-gates, postgres16-gates, backup-restore-gates) |
| Commit SHA exercised by the run | cf6617d7955bbfd6bd3e8c1bd71fecf983072482 |
| PostgreSQL Image (service container tag) | postgres:16 |
| VERIFIED PostgreSQL Version (from `SELECT version()`, never the image name) | PostgreSQL 16.14 (Debian 16.14-1.pgdg13+1) on x86_64-pc-linux-gnu, compiled by gcc (Debian 14.2.0-19) 14.2.0, 64-bit |

## Provider posture in CI (must hold in the observed run)

| Field | Required value | Observed |
| --- | --- | --- |
| Provider Runtime Enabled (`PROVIDER_RUNTIME_ENABLED`) | must be `false` (or unset — default-OFF per `src/runtime/provider/feature-flag.ts`) | false — set workflow-wide and re-asserted per job; evidence JSON providerRuntimeEnabled=false |
| Provider Key Present In CI (`DEEPSEEK_API_KEY` in secrets/env) | must be **NO** | NO — no secrets context used anywhere in the workflow; forbidden-string sweep clean |
| Real Provider Calls Executed By CI | must be **0** (the canary suite is `describe.skipIf`-gated and `RUN_PROVIDER_CANARY` is never set in CI) | 0 — evidence JSON realProviderCallsExecutedByCI=0 (per-DB runtime/test/canary = 0/0/0); canary suite skip-gated |

If any of the three observed values deviates from its required value, the run is a
`SECURITY_GATE_FAILURE` regardless of job conclusions (see
`docs/release-candidate/CI_FAILURE_RECOVERY_MATRIX.md`).

## Job 1 — static-gates

| Gate | Result |
| --- | --- |
| Typecheck (`npm run typecheck`) | PASS (run 29654550660) |
| Full test suite (`npm test`; canary skip-gated by design) | PASS (run 29654550660) |
| Production build (`npm run build:web`) | PASS (run 29654550660) |
| Security scan (`npm run security-scan`) | PASS (run 29654550660) |
| Repo safety preflight (`npm run repo:safety:preflight`) | PASS (run 29654550660) |

## Job 2 — postgres16-gates (against the postgres:16 service container)

| Gate | Result |
| --- | --- |
| Migrations 0001–0008 fresh-apply (`scripts/db/migrate.mjs`) | PASS (run 29654550660) |
| Migration manifest verify (`migrations/manifest.json` frontier consistent with applied set) | PASS (run 29654550660) |
| Database purpose preflight (`DatabaseEnvironmentPreflightV1` role/purpose checks) | PASS (run 29654550660) |
| Constraint verify (CHECK/FK/NOT NULL battery) | PASS (run 29654550660) |
| Trigger verify (history-table triggers present and firing) | PASS (run 29654550660) |
| Append-only verify (UPDATE/DELETE rejected on history tables incl. `provider_execution`) | PASS (run 29654550660) |
| Provider ledger + identity metadata (whitelisted column set; `gateway_vendor` / `model_vendor` / `protocol` closed CHECK sets; no secret/host/content column) | PASS (run 29654550660) |
| Concurrent idempotency (re-migrate applies 0; duplicate idempotency key yields exactly one row) | PASS (run 29654550660) |
| Tenant isolation (cross-client 403 + empty-own-view control) | PASS (run 29654550660) |
| Agency assignment isolation (agency sees only ACTIVE-assigned clients) | PASS (run 29654550660) |
| Restart E2E (pool restart / `pg_terminate_backend` self-heal + durable read-back) | PASS (run 29654550660) |
| Session rotation E2E (K1→K2 window honored; old cookie rejected after retirement; re-login OK) | PASS (run 29654550660) |
| Closed pilot role E2E (sanitized 3-role chain over real route handlers; 401/403 per hop) | PASS (run 29654550660) |

## Job 3 — backup-restore-gates (against the postgres:16 service container)

| Gate | Result |
| --- | --- |
| Backup (`scripts/backup/backup.mjs` custom-format dump) | PASS (run 29654550660) |
| Checksum (sha256 recorded and re-verified for the dump artifact) | PASS (run 29654550660) |
| Restore (`scripts/backup/restore.mjs` into a FRESH database) | PASS (run 29654550660) |
| Read-back (restored business rows + append-only triggers verified in the restored DB) | PASS (run 29654550660) |

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
