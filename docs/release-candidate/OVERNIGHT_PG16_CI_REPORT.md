# OVERNIGHT_PG16_CI_REPORT — AUTOMATED_PG16_RELEASE_GATE_V1

Generated: 2026-07-19 (overnight autonomous loop). No secrets appear in this report.
Every remote result below is read from observed GitHub Actions runs (IDs cited); NOT_RUN is
never recorded as PASS.

## Identity

- Starting SHA: c7c2ab49b5ce7f7ecda45815ae43ae317739ef28 (phase baseline = closed-pilot RC final;
  original frozen baseline b31c2cdad512ed028b7f84010042bc0b02883316)
- Current Integration SHA: 7533b0308910976496c5c850e44de3603d6bcf73 + final docs commits
  (integration/closed-pilot-rc-ci-v1; local == remote verified at each checkpoint)
- Workflow Commit SHA: 98e7863 (authored, Agent B) reconciled by f5bfe6c → bb7d1b6 → cf6617d (Agent A)
- Workflow Run ID: 29654550660 (the PG16 gate run, run #3) — confirming run 29655873382 (run #6,
  includes the pool-drill flake fix); docs-only run #5 29655365662 also green
- Workflow Run URL: https://github.com/JustinXai/geoplane/actions/runs/29654550660
- Workflow Conclusion: success (all 3 jobs: static-gates, postgres16-gates, backup-restore-gates)

## PostgreSQL 16 facts (from the evidence artifact + SELECT version(), never the image name)

- PostgreSQL Image: postgres:16 (job-scoped service container, destroyed per job)
- Verified PostgreSQL Version: PostgreSQL 16.14 (Debian 16.14-1.pgdg13+1) on x86_64-pc-linux-gnu,
  compiled by gcc (Debian 14.2.0-19) 14.2.0, 64-bit
- Migration Count: 8 (0001–0008, applied fresh to all three CI databases)
- Table Count: 42
- Constraint Count: 294
- Trigger Count: 24

## Databases in CI

- Runtime Database Purpose: geoplane_ci_runtime — migrations/health/runtime verification
- Test Database Purpose: geoplane_ci_test — automated DB gates, freely truncated
- Canary Database Purpose: geoplane_ci_canary — environment-isolation verification ONLY (no real
  provider call ever)
- Database Separation: PASS (distinctness + purpose-name guards in create-isolated-databases;
  DatabaseEnvironmentPreflightV1 3/3; production-name refusal; everything localhost service-container)

## Provider posture in CI

- Provider Runtime Enabled: false (workflow-wide + per job; evidence JSON providerRuntimeEnabled=false)
- Provider Key Present In CI: NO (no secrets context anywhere in the workflow; forbidden-string
  sweep clean; key deleted-unread by the gate scripts)
- Real Provider Calls Executed By CI: 0 (evidence realProviderCallsExecutedByCI=0; per-DB 0/0/0;
  canary suite skip-gated, RUN_PROVIDER_CANARY never set)
- Cumulative real provider call count for the project: still exactly 1 (the frozen micro canary)

## Gate results (run 29654550660)

- Migration Verify: PASS (runtime+test+canary each at 0008, 8 applied)
- Manifest Verify: PASS (manifest consistent, head 0008)
- Tenant Isolation: PASS (11 tests)
- Agency Assignment Isolation: PASS (2 tests)
- Provider Ledger Identity: PASS (gateway_vendor / model_vendor / protocol persisted and
  row-matched post-restore; 13 ledger tests)
- Provider Ledger Append-only: PASS (UPDATE + DELETE rejected, re-exercised post-restore)
- Backup: PASS (custom-format dump, sha256 re-hashed and matched)
- Restore: PASS (into a fresh PG16 database; read-back of accounts / knowledge raw content /
  opportunities / articles / deliveries / audit / provider ledger)
- Restart E2E: PASS
- Session Rotation E2E: PASS
- Closed Pilot Role E2E: PASS (6 tests, sanitized 3-role chain over real routes)
- Constraints / Triggers / Append-only / Concurrent Idempotency / Purpose Preflight / Readiness:
  all PASS (evidence JSON gates block, 14/14)

## Repeatability

- Repeatability Round 1: PASS (7/7 gates, fresh DBs — local PG18 audit, Agent D)
- Repeatability Round 2: PASS (7/7, fresh DBs)
- Repeatability Round 3: PASS (7/7, fresh DBs)
- Remote PG16 gate additionally green on three separate runs (#3, #5, #6).
- Flaky Gate Count: 1 found in CI and FIXED — run #4 (docs-only) hit a timing race: the killed
  checked-out client in pool-restart drill (b) emitted an unobserved 57P01 socket error (pg pool
  'error' covers idle clients only). Root-caused from logs, fixed with a per-client listener
  (assertions unchanged), confirming run #6 green. Not masked by rerun; recorded here honestly.

## Local final gate (integrated tree)

- Full Tests: PASS — 876 passed / 1 skipped (the flag-gated canary, by design)
- Typecheck: PASS
- Next Build: PASS (next build --webpack)
- Security Scan: PASS (clean)
- Repo Safety Preflight: PASS

## Supervisor

- Supervisor Decision: PASS_WITH_CHANGES — 0 real violations (audit @ ac4d964, merged).
  Docs: PG16_CI_SECURITY_AUDIT (PASS), PG16_CI_DATABASE_AUDIT (PASS), PG16_CI_EVIDENCE_AUDIT
  (PASS), PG16_CI_STATUS_MATRIX (28-row matrix all PASS). Minor recommendations (non-blocking):
  job-3 could add its own SELECT version() assertion; geoplane_runtime name is outside
  PRODUCTION_DB_PATTERN by design (CI safety rests on verified localhost-only isolation).

## Decision

- POSTGRESQL16_VERIFY: **PASS** (remote CI, real PostgreSQL 16.14; supersedes the local
  BLOCKED_PENDING_ENV state, which remains true for the local machine only)
- Open Blockers: none technical. Remaining items are the 6 HUMAN_PENDING sign-offs in
  CLOSED_PILOT_RELEASE_CHECKLIST.md (human gates by definition).
- Release Decision: **CLOSED_PILOT_READY_FOR_HUMAN_APPROVAL**
  (NOT auto-deploy, NOT auto-merge to main, NOT customer opening — a human decision point.)
- Exact Next Single Action: PRESENT CLOSED PILOT RELEASE CANDIDATE FOR HUMAN APPROVAL
