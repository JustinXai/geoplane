# OVERNIGHT_CLOSED_PILOT_RC_REPORT — CLOSED_PILOT_RELEASE_CANDIDATE_V1

Generated: 2026-07-19 (overnight autonomous loop AUTONOMOUS_CLOSED_PILOT_RC_OVERNIGHT_LOOP_V1)
No secrets appear in this report.

## Identity and integration

- Starting SHA: b31c2cdad512ed028b7f84010042bc0b02883316 (integration/pilot-readiness-v1)
- Current Integration SHA: f7e794e955876f00ccbc9dee3734e3b52101595b (integration/closed-pilot-rc-v1)
- Agent B SHA / Status: f30d839 / COMPLETE — PROVIDER_IDENTITY_LEDGER_V1 (merged 780d2e3)
- Agent C SHA / Status: 7b2296d / COMPLETE — ENVIRONMENT_CONFIGURATION_RECONCILIATION_V1 (merged 487647f)
- Agent D SHA / Status: bd3dff2 / COMPLETE (BLOCKED PATH) — POSTGRESQL16_VERIFY = BLOCKED_PENDING_ENV (merged bb966f8)
- Agent E SHA / Status: c505c88 / COMPLETE — CLOSED_PILOT_OPERATIONS_V1 (merged 93ad279)
- Supervisor SHA / Status: 31f7ce9 / COMPLETE — PASS_WITH_CHANGES, 0 real violations (merged f7e794e)
- Running Agent Count: 0 (all lanes complete; no orphaned worktrees; every lane branch pushed)

## Provider

- Migration Count: 8 (0001–0008, manifest-driven single registry)
- Table Count: 42 (public schema, post-0008)
- Gateway Vendor: ALIYUN_MAAS (canonical identity contract src/runtime/provider/identity.ts;
  the historical canary row is backfilled UNKNOWN_LEGACY by design)
- Model Vendor: DEEPSEEK
- Provider Protocol: OPENAI_COMPATIBLE
- Provider Real Call Count: 1 (verified directly in the canary DB ledger: exactly one row,
  model deepseek-v4-flash; test DB contains 0 non-offline rows)
- Provider Runtime Default: OFF (PROVIDER_RUNTIME_ENABLED=false verified in .env.local;
  no committed file enables it; canary test is describe.skipIf-gated and was SKIPPED in every run)
- Provider Ledger Identity: PASS (gateway_vendor / model_vendor / protocol persisted, closed CHECK
  sets, mandatory declaration for new rows)
- Provider Ledger Append-only: PASS (UPDATE and DELETE rejected by triggers, re-verified post-0008)
- Provider Secret Field Count: 0 (no api key / authorization / base URL / endpoint host /
  workspace id column or record field; enforced by exact column/key whitelist tests)
- Provider Raw Content Field Count: 0 (no prompt / response / content field; token counts only)

## Databases

- Runtime Database Purpose: geoplane_runtime — local/staging application runtime (GEO_DATABASE_URL)
- Test Database Purpose: geoplane_runtime_test — automated tests, freely TRUNCATEd (GEO_TEST_DATABASE_URL)
- Canary Database Purpose: geoplane_canary — provider-canary isolation only (GEO_CANARY_DATABASE_URL)
- Database Purpose Separation: PASS — DatabaseEnvironmentPreflightV1 3/3 roles PASS; canary runner
  reads ONLY GEO_CANARY_DATABASE_URL, refuses runtime/test targets, requires 'canary' in the db name;
  closed 6-code error taxonomy (URL_MISSING / AUTH_FAILED / ROLE_INVALID / PURPOSE_MISMATCH /
  UNREACHABLE / MIGRATION_BEHIND)
- PostgreSQL Runtime Version: 18.3 (local instance)
- PG16 Environment Attempt: ONE full attempt (Agent D) — Docker engine unstartable (WSL2 kernel
  missing; `wsl --update` fails with OS-level "Catastrophic failure"); no standalone PG16 binaries.
  Evidence: docs/release-candidate/POSTGRES16_ENVIRONMENT_ATTEMPT.md. No repeated patching.
- PG16 Migration Verify: BLOCKED_PENDING_ENV (honest NOT_RUN — never recorded as PASS)
- PG18 Equivalent Verify: PASS (scripts/backup/pg-verify.mjs --test: 6/6 — fresh throwaway DB
  migrations 8/8 to 0008, constraints, append-only triggers, idempotency, restart read-back,
  provider ledger shape)

## E2E and invariants

- Closed Pilot Role E2E: PASS (full sanitized chain over real route handlers, correct role per hop,
  401/403 asserted per hop; independently re-run at integration — not agent-self-reported)
- Restart E2E: PASS (app restart + pool restart via pg_terminate_backend, self-healing verified)
- Session Rotation E2E: PASS (K1→K2 window honored, old cookie rejected after retirement, re-login OK)
- Backup Restore E2E: PASS (suite-level with full business data field-for-field ledger equality;
  plus explicit gate run: backup --test → restore to fresh DB, RESTORED tables=42 indexes=179
  triggers=25; restore requires --user postgres, one diagnosed retry, no loop)
- Tenant Isolation: PASS (cross-client 403 + empty-own-view control)
- Agency Assignment Isolation: PASS (agency sees only assigned clients)
- Audit Actor Integrity: PASS (24 domain actions + DENIED rows, hashed)
- Automatic Human Review: NO (route 422 + DB CHECK refuse system actor)
- Automatic Article Approval: NO (0 approvals pre-review verified)
- Automatic Publication: NO (system actor on receipt rejected with zero writes)
- Default Selected Channel Count: 0 (publish package target_channel_ids={})
- Real Customer Data Used: 0 (all pilot data obviously fictional)

## Gates (at 93ad279, re-verified docs-only merges through f7e794e)

- Focused Tests: PASS (provider 103/103; provider+staging+pilot 195 passed / 1 gated skip;
  pilot re-run 10 passed / 1 gated skip)
- Full Tests: PASS — 876 passed / 1 skipped (87 files; the 1 skip is the flag-gated canary, by design)
- Typecheck: PASS
- Next Build: PASS (next build --webpack)
- Security Scan: PASS (clean)
- Repo Safety Preflight: PASS

## Supervisor

- Verdict: PASS_WITH_CHANGES — zero real violations. Follow-ups (non-blocking, next phase):
  (1) defense-in-depth: assert current_database() ILIKE '%test%' at TRUNCATE time in shared pg-test
  setup; (2) cosmetic: stop printing PROVIDER_BASE_URL host to operator stdout in micro-canary.mjs;
  (3) pre-existing: audit_event has no forbid-mutation trigger (relies on event_hash) — future hardening.
- Audit docs: PROVIDER_IDENTITY_AUDIT.md (PASS), ENVIRONMENT_CONFIGURATION_AUDIT.md
  (PASS_WITH_CHANGES), POSTGRES16_COMPATIBILITY_AUDIT.md (PASS — zero false PG16 claims),
  CLOSED_PILOT_RC_STATUS.md.

## Decision

- Open Blockers: PostgreSQL 16 canonical verify only (environment-level; everything else green)
- Release Decision: **CLOSED_PILOT_RC_PENDING_PG16**
- Exact Next Single Action: PROVISION ISOLATED POSTGRESQL 16 ENVIRONMENT AND RUN FINAL
  COMPATIBILITY GATE (next phase AUTOMATED_PG16_RELEASE_GATE_V1: GitHub Actions ubuntu runner +
  postgres:16 service container — no local Docker/WSL2 repair, no real provider key in CI)
