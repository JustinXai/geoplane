# CLOSED_PILOT_RC_STATUS — Supervisor Release Candidate Audit

- Phase: `CLOSED_PILOT_RELEASE_CANDIDATE_V1` / `CLOSED_PILOT_RC_SUPERVISOR_AUDIT_V1`
- Supervisor branch: `audit/closed-pilot-rc-supervisor-v1`
- Audited tree: baseline `b31c2cd` + merge of `integration/closed-pilot-rc-v1` = `93ad2798180315e826f4d5b4bf6a93669d084db5` (fast-forward; the only tree change besides the four audit documents in this directory)
- Method: read-only audit — code, migrations, git history, docs. No test suite run (final gate running concurrently in the integration lane), no DB connection, no provider call, no secret printed.
- Date: 2026-07-18

## Integrated agent SHAs (verified in `git log b31c2cd..93ad279`)

| Agent | Checkpoint | SHA | Verified content |
| --- | --- | --- | --- |
| B | PROVIDER_IDENTITY_LEDGER_V1 | `f30d839` | `migrations/0008_provider_identity.sql` (gateway_vendor / model_vendor / protocol + UNKNOWN_LEGACY DDL backfill), `src/runtime/provider/identity.ts`, adapter/ledger threading, identity tests. `git show --stat` matches. |
| C | ENVIRONMENT_CONFIGURATION_RECONCILIATION_V1 | `7b2296d` | 3 DB env roles (`src/persistence/config.ts:30-41`), `DatabaseEnvironmentPreflightV1` (`src/runtime/observability/database-environment-preflight.ts` + CLI + tests), canary runner reads only `GEO_CANARY_DATABASE_URL` (`scripts/provider/micro-canary.mjs:55-65`). |
| D | POSTGRESQL16_STAGING_VERIFY_V1 | `bd3dff2` | Evidence doc ONLY (`docs/release-candidate/POSTGRES16_ENVIRONMENT_ATTEMPT.md`, 84 insertions, no other file) — status BLOCKED_PENDING_ENV. |
| E | CLOSED_PILOT_OPERATIONS_V1 | `c505c88` | `tests/pilot/closed-pilot-operations.e2e.pg.test.ts` — sanitized 3-role HTTP chain + restart / pool / key-rotation / backup-restore drills + standing-invariant re-proofs. |

Integration head `93ad279` merges all four onto baseline `b31c2cd`.

## Invariant table (checklist items 1-10)

| # | Invariant | Verdict | Key evidence (details in the sibling audit docs) |
| --- | --- | --- | --- |
| 1 | Gateway identity = ALIYUN_MAAS / DEEPSEEK / OPENAI_COMPATIBLE everywhere; no "DeepSeek direct" mislabel | **PASS** | `identity.ts:87-91`; `0008:65-76`; canary test :113-118,176; `PROVIDER_MICRO_CANARY_REPORT.md:15,54-59`. See PROVIDER_IDENTITY_AUDIT.md item 1. |
| 2 | Ledger + records + structured logging carry NO endpoint host / base URL / workspace id / key / prompt / response; tests enforce column/key whitelists | **PASS** | `0007:66-139`; `0008:55-61`; `records.ts:30-88`; `pg-provider-ledger.ts:198-225`; `logger.ts:27-99,173-189`; whitelist tests `provider-ledger.pg.test.ts:157-222`. Minor: canary runner prints base-URL host to console (never persisted) — cleanup suggested. |
| 3 | Runtime/Test/Canary DB separation; canary refuses runtime/test targets; tests contained to test DB; preflight taxonomy | **PASS_WITH_CHANGES** | Roles `config.ts:30-41`; canary guards `micro-canary.mjs:55-65`; all 27 test `loadDatabaseConfig` call sites use `{test:true}`; taxonomy `database-environment-preflight.ts:41-47,114-156`. Gap: db-name guard lives in preflight only, not at TRUNCATE time in the test bootstrap. See ENVIRONMENT_CONFIGURATION_AUDIT.md 3c. |
| 4 | Real provider call count still exactly 1; canary skip-gated out of `npm test`; no new real-call sites; flag never globally enabled | **PASS** | `describe.skipIf` gate (canary test :27,59); `RUN_PROVIDER_CANARY` set only by `micro-canary.mjs:84`; single-call fetch guard :106,143; all flag-true tests use fake fetch + global-fetch spy; only `.env.example` tracked; `feature-flag.ts:35-41` default OFF. |
| 5 | Tenant isolation & agency-assignment isolation enforced | **PASS** | `geo-command-runtime.ts:388-400` (`sessionCanAccessClientOrganization`: CLIENT → own org only, AGENCY → ACTIVE-assigned only) with server-side tenant resolution (:25-28, never caller-supplied); E suite asserts 401/403 at every hop and agency sees only ACTIVE-assigned clients (`closed-pilot-operations.e2e.pg.test.ts:460-485,920-942`). |
| 6 | Audit actor integrity; Human Review + Article Approval cannot auto-approve (DB CHECKs + route rejection) | **PASS** | `audit_event.actor_user_id` NOT NULL FK + `event_hash` (`0001:364-380`); `human_review_decision` no-default decision + `ck_human_review_no_silent_approve` + append-only triggers (`0003:234-316`); `article_approval` `ck_article_approval_no_silent_approve` + gates-PASSED CHECKs + append-only (`0004:321-364`); publication `ck_publication_receipt_no_auto_publish` (`0004:484-491`) mirrored at runtime by `FORBIDDEN_AUTOMATIC_ACTOR_IDS` (`entities.ts:1411-1417`); E suite: system actor → 422, zero rows written (:877-891), nothing auto-approved (:725). |
| 7 | Automatic publication off; default selected channel count 0 | **PASS** | `publish-packages/route.ts:136-139` (count derived from `targetChannelIds`, zero by construction — no auto-selection); E suite asserts 0 in the response AND the durable row (:858,1461-1467); publication requires a human actor per item 6. |
| 8 | PG16 never falsely claimed PASS; PG18 equivalence always labelled PG18 | **PASS** | `POSTGRES16_ENVIRONMENT_ATTEMPT.md:4` BLOCKED_PENDING_ENV; full doc sweep hit-by-hit in POSTGRES16_COMPATIBILITY_AUDIT.md — every mention is blocked/deferred/not-run or PG18-labelled. |
| 9 | History append-only after 0008 (provider_execution + other history tables) | **PASS** | `0007:150-162` triggers intact; 0008 is ADD COLUMN/CONSTRAINT + DROP DEFAULT only (DDL backfill, no row UPDATE); zero `DROP TRIGGER`/`DISABLE TRIGGER` anywhere; immutability re-tested (`provider-identity-migration.pg.test.ts:378`; E suite :1447-1459). |
| 10 | No secrets in the committed tree; only `.env.example` tracked, CHANGE_ME only | **PASS** | Targeted secret-pattern greps clean; `.gitignore:10-12`; `.env.example` all-placeholder; adapter/canary never print or store the key. |

## Open blockers / follow-ups

1. **PG16 canonical verification — BLOCKED_PENDING_ENV (operator-gated, non-code).** WSL2/Docker
   broken on host and no PG16 binaries (PG18.3 only). Unblock per
   `POSTGRES16_ENVIRONMENT_ATTEMPT.md:78-84`, then run checkpoint
   POSTGRESQL16_STAGING_VERIFY_V1. Honest status is consistently reported everywhere; not an RC
   code defect.
2. **Recommendation (test-only): TRUNCATE-time db-name assertion.** Add
   `current_database() ILIKE '%test%'` (or equivalent) to the shared pg-test `beforeAll` so a
   mis-pointed `GEO_TEST_DATABASE_URL` fails fast even when the operator skips
   `npm run preflight:db-env`. Defense-in-depth; primary containment already verified.
3. **Recommendation (script cosmetic): drop the base-URL host console print** at
   `scripts/provider/micro-canary.mjs:76` so the endpoint host appears nowhere at all, even in
   transient operator stdout.
4. **Pre-existing observation (no change requested):** `audit_event` (0001) relies on
   `event_hash` tamper-evidence and has no DB-level forbid-mutation trigger, unlike the other
   history tables. Pre-baseline design, untouched by this RC; flagged for a future hardening pass.
5. **Final integration gate:** the concurrent full-suite run in the integration lane must report
   green; this audit deliberately did not execute tests (shared test DB).

## Per-audit-doc verdicts

| Document | Verdict |
| --- | --- |
| PROVIDER_IDENTITY_AUDIT.md | **PASS** |
| ENVIRONMENT_CONFIGURATION_AUDIT.md | **PASS_WITH_CHANGES** (item 3c recommendation) |
| POSTGRES16_COMPATIBILITY_AUDIT.md | **PASS** (verification itself remains operator-gated) |

## Overall Supervisor verdict

**PASS_WITH_CHANGES.**

No real violation of any frozen fact or system invariant was found in the integrated tree: the
provider identity is accurate end-to-end, the ledger and logs are structurally leak-free, the real
provider call count remains exactly 1 with default-OFF discipline intact, tenancy/approval/
publication invariants hold at both DB and route level, history stays append-only through 0008, and
no secret is committed. The "WITH_CHANGES" qualifier covers the two small defense-in-depth
follow-ups (blockers list items 2-3) and the standing operator-gated PG16 environment item (item 1),
none of which require product-code changes before the closed pilot proceeds — contingent on the
integration lane's concurrent final test gate reporting green.
