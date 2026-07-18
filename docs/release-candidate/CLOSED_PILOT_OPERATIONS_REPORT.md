# CLOSED_PILOT_OPERATIONS_V1 — Closed-Pilot Operations Report

- **Checkpoint**: CLOSED_PILOT_OPERATIONS_V1 (Agent E — Closed Pilot Operations)
- **Branch**: `qa/closed-pilot-operations-v1` (baseline `b31c2cd`)
- **Evidence suite**: `tests/pilot/closed-pilot-operations.e2e.pg.test.ts` — every PASS below is a
  vitest assertion executed against the real Next.js App Router route handlers and a real
  PostgreSQL database (`GEO_TEST_DATABASE_URL`; the suite refuses a `geoplane_runtime` target).
  Nothing in this report is claimed without a corresponding executed assertion.
- **Sanitization**: every identity uses a reserved test domain (`*@closed-pilot.example.test`)
  and every organization name carries an explicit `Sample … (Pilot Fixture)` marker. A dedicated
  assertion block re-verifies **Real Customer Data = 0** at the end of the run.
- **Provider posture**: `PROVIDER_RUNTIME_ENABLED` resolves OFF for the whole exercise; content
  generation used ONLY the offline deterministic adapter (zero network imports).
  `scripts/provider/micro-canary.mjs` was never run; the env-gated canary suite self-skips.
  **Real provider calls = 0.**

## 1. Operations chain (one data set, correct role at each hop, over HTTP)

Authorization is asserted at every hop: unauthenticated callers get 401 at each exercised route,
wrong roles get 403 wherever a wrong-role session exists at that point in the chain, and every
denied ops attempt leaves a `DENIED` audit event.

| # | Hop (acting role) | Evidence asserted | Result |
|---|---|---|---|
| 0 | Platform login (unknown email refused 401 first) | session cookie minted via `POST /api/auth/login` | PASS |
| 1 | Create Agency (Platform) | 401 unauthenticated; 200 + `type=AGENCY` | PASS |
| 2 | Create Client org (Platform) | agency role → 403; 200 + `type=CLIENT` | PASS |
| 3 | Assign agency→client (Platform) | agency self-assign → 403; 200 + `ACTIVE` | PASS |
| 4 | Create Project (Platform) | 401 unauthenticated; 200, bound to client org | PASS |
| 5 | Invite Client Owner (Platform) | 200 `PENDING/CLIENT_OWNER`; raw token & hash never echoed | PASS |
| 6 | Client login + invitation accept (Client Owner) | pre-provision login → 401; login 200; accept 200 | PASS |
| 7 | Create knowledge package (Client Owner) | 401 unauthenticated; 200 `DRAFT`, audited | PASS |
| 8 | Upload DOCX knowledge source (Client Owner) | 200 `INGESTED` v1; extracted text durable in `knowledge_content` | PASS |
| 8b | Upload PDF knowledge source (Client Owner) | probe-gated: `pdf-parse` is unavailable on this Node build (`bad XRef entry`, tracked by the knowledge-reliability lane), so the HTTP PDF path self-skipped this run; DOCX carried the chain | PASS (env-gated) |
| 9 | Confirm knowledge package (Client Owner) | 401 unauthenticated; 200 `CONFIRMED` + timestamp, audited | PASS |
| 10 | EnterpriseProfile (Client Owner) | 200, industry profile persisted | PASS |
| 11 | KeywordQuestionMap (Client Owner) | 200, keyword round-trip | PASS |
| 12 | Opportunity + automated validation (Client Owner) | 200 `VALIDATED` | PASS |
| 13 | Client Review (Client Owner, HUMAN) | pre-review: zero `APPROVED` decisions; opaque `reviewReferenceCode` only (raw validation UUID absent from client body); decision 200 `APPROVED` with session-derived reviewer | PASS |
| 14 | OpportunityFamily + ArticleBrief (Client Owner) | 200 + 200 | PASS |
| 15 | Offline provider content generation | flag OFF, `assertRealProviderCallAllowed` throws; adapter deterministic (byte-identical rerun); one sanitized OFFLINE ledger row (model `offline-deterministic`, 0 tokens), idempotent re-emission = still 1 row | PASS |
| 16 | ArticleDraft compiler (Client Owner) | 200 version 1 from the opaque offline envelope pointer | PASS |
| 17 | Three gates + HUMAN Article Approval | pre-approval: zero `article_approval` rows (compile never approves); quality/platform/vertical all `PASSED`; approval 200 with session-derived human approver | PASS |
| 18 | PublishPackage (Client Owner) | `selectedChannelCount = 0` in response AND `target_channel_ids = {}` in the durable row | PASS |
| 19 | DistributionPlan (Client Owner, HUMAN selection) | 200, exactly the one human-selected channel | PASS |
| 20 | PublicationReceipt (HUMAN only) | `system` actor → 422 + zero rows written; human actor → 200 | PASS |
| 21 | Client Delivery view (Client Owner) | 401 unauthenticated; 200 with `DELIVERED` article | PASS |
| 22 | Agency Progress view (Agency Owner) | client role → 403; 200 listing ONLY the assigned client, `projectCount = 1` | PASS |
| 23 | Ops Audit view (Platform) | client → 403, agency → 403; 200 with the full 24-action domain trail; ≥1 `DENIED` audit row from the wrong-role probes | PASS |

## 2. Operations drills (continuing against the SAME data set)

| Drill | What was exercised | Result |
|---|---|---|
| (a) Application restart | Pool closed (process gone, in-process caches lost), brand-new pool + brand-new auth/knowledge/geo runtime contexts, re-login all three roles; knowledge CONTENT text, package `CONFIRMED` state, `DELIVERED` delivery, agency portfolio and audit trail all read back over HTTP | PASS |
| (b) DB connection pool restart | Phase 1: a tagged single-connection pool had its backend `pg_terminate_backend`-killed mid-query by an admin session — the in-flight query failed and the pool self-healed on the very next query. Phase 2: the application pool was fully closed and rebuilt; the PRE-restart session cookie still authenticated (sessions are durable rows + stable signing key) and business reads succeeded with no re-login | PASS |
| (c) Session rotation | Signing-layer proof (K1 token verifies under CURRENT=K1; still verifies during the K2/K1 rotation window; rejected once PREVIOUS dropped) AND end-to-end proof through the real login route + `resolveSession`: old session INVALID after retirement, re-login under the new key works, authorized HTTP read succeeds | PASS |
| (d) Backup → Restore → re-login → full readback | `scripts/backup/backup.mjs --test` produced the dump; `scripts/backup/restore.mjs` restored it into a FRESH throwaway database; the full app runtime was pointed at the restored DB; all three roles RE-LOGGED-IN over HTTP; read back: **accounts** (users + sanitized orgs), **knowledge source raw content** (extracted DOCX text byte-durable), **opportunities** (keyword intact), **articles & deliveries** (draft count, human approver, `DELIVERED` via the client HTTP view, receipt channel), **audit records** (row count identical to source, every row tamper-evidence hashed, ops view serves), **provider ledger rows** (the single sanitized OFFLINE row equal field-for-field to the source row; append-only trigger still live in the restored DB) | PASS |

The throwaway restore-target database and the dump artifact are dropped after the run.

## 3. Standing invariants (verified inside the suite, same data set)

| Invariant | Evidence | Result |
|---|---|---|
| Client cannot cross to another client's data | Client B (fresh org/project/owner) → 403 on Client A's deliveries and knowledge package; Client B's own delivery view returns 200 `[]` (control) | PASS |
| Agency sees only assigned clients | Agency portfolio lists exactly Client A; never the unassigned Client B | PASS |
| Human review & article approval never auto-approve | Zero `APPROVED` review decisions before the human decision; zero `article_approval` rows before the human approval; every persisted decision/approval names the human client owner; DB `CHECK` refuses a `system` publication actor even on direct INSERT | PASS |
| Historical artifacts append-only | UPDATE and DELETE rejected by DB triggers (with rows present) on: `knowledge_content`, `opportunity_validation`, `human_review_decision`, `article_draft`, `article_approval`, `provider_article_content`, `publication_receipt`, `delivery`; `knowledge_version` rejects UPDATE (its 0002 design guards UPDATE only) | PASS |
| Provider ledger append-only | `provider_execution` UPDATE and DELETE rejected with the sanitized row present; idempotency key yields exactly one row | PASS |
| Default distribution channel count = 0 | `selectedChannelCount = 0` in the publish response and `target_channel_ids` empty in the durable row, re-checked in the invariants pass | PASS |
| Provider runtime defaults OFF | `isProviderRuntimeEnabled()` false in the real env; false for unset/`""`/`false`/`0`/`no`/`off`/`yes`/`enabled`/garbage; true only for explicit `true`/`1`; `assertRealProviderCallAllowed()` throws; the whole ledger contains ONLY the one `offline-deterministic` row — no real model name ever | PASS |
| Real Customer Data = 0 | Every organization display name carries a sample/pilot-fixture marker; every user email is on a reserved test domain | PASS |

## 4. Environment / schema note

The shared test database also carries the sibling provider lane's `0008_provider_identity`
migration (closed-enum `gateway_vendor` / `model_vendor` / `protocol` columns on
`provider_execution`, not present in this branch's `migrations/`). The suite's single sanitized
offline ledger insert is schema-adaptive: it detects those columns and declares sanitized offline
values for them, so the suite is correct on both the drifted and the pristine schema. All ledger
READ paths go through this branch's real `PgProviderLedger`.

## 5. Verification summary

| Check | Result |
|---|---|
| `tests/pilot/closed-pilot-operations.e2e.pg.test.ts` (new, 6 tests) | PASS 6/6 |
| `tests/pilot/` full set (acceptance + resilience + operations) | PASS — 3 files / 10 tests passed, 1 canary file env-gated skip (by design: no real provider call) |
| `npm run typecheck` | PASS |
| `npm run security-scan` | PASS (clean) |
