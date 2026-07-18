# PILOT_ACCEPTANCE_REPORT — PILOT_ACCEPTANCE_V1 (Agent F)

Pilot-readiness acceptance for **geoplane**. A fully-desensitized, three-role pilot is driven
end-to-end through the **real** Next.js App Router route handlers against a **real PostgreSQL**
database, followed by three operational resilience drills (restart / session-key rotation /
backup + restore). This report records exactly what was exercised, the results, and the
section-16 final-report fields the pilot lead can sign off.

- Branch: `qa/pilot-acceptance-v1` (from pilot HEAD `3d2da9c` — full integrated pilot runtime).
- Test database: `GEO_TEST_DATABASE_URL` → `geoplane_pl_f` (a throwaway/staging db; **never**
  `geoplane_runtime`).
- Provider posture: `PROVIDER_RUNTIME_ENABLED=false` for the entire run — **no real model call is
  possible**; content enters only as an opaque offline envelope pointer.
- Deliverables under this report:
  - `tests/pilot/pilot-acceptance.e2e.pg.test.ts` — the three-role E2E.
  - `tests/pilot/pilot-resilience.e2e.pg.test.ts` — restart / rotation / backup+restore drills.

---

## 1. What was exercised (the pilot chain, every link over HTTP unless noted)

Three **desensitized** role accounts — Real Customer Data = 0 (all fixtures use reserved test
domains `*.example.test` and org names carry a `Sample`/`Pilot Fixture` marker):

| Role | Fixture organization | Fixture identity |
| --- | --- | --- |
| Platform Admin (`PLATFORM_SUPER_ADMIN`) | Sample Platform Operator (Pilot Fixture) | `platform-admin@pilot.example.test` |
| Agency Owner (`AGENCY_OWNER`) | Sample Content Agency (Pilot Fixture) | `agency-owner@pilot.example.test` |
| Client Owner (`CLIENT_OWNER`) | Sample Manufacturing Enterprise (Pilot Fixture) | `client-owner@pilot.example.test` |

The chain, each link asserted:

1. **Platform login** (real `POST /api/auth/login`, signed `geo_acceptance_session` cookie threaded
   into every later request).
2. **Create Agency** → **Create Client** → **Assign agency (ACTIVE)** → **Create Project** (all via
   `/api/ops/*` and `/api/commands/projects`).
3. **Invite Client Owner** (`POST /api/projects/[id]/invitations` — only the token **hash** is
   persisted; the raw token is never returned).
4. **Client login** + **accept invitation** (real accept route).
5. **Create Knowledge Package** (audited command) → **Upload a real DOCX** (`sample.docx` bytes; the
   extracted text is read back out of the durable Postgres content store — a real DB round-trip) →
   **Confirm (seal) the knowledge package** (audited command).
6. **EnterpriseProfile** (industry profile) → **KeywordQuestionMap** → **Opportunity** (+ automated
   validation → VALIDATED).
7. **Client Review CONFIRMED** via the **opaque `reviewReferenceCode`** read from
   `GET /api/projects/[id]/review-queue`. The client body is asserted to contain **no raw validation
   UUID** (SAFE_REVIEW_REFERENCE_V1); the review is submitted with the opaque code, never an internal id.
8. **OpportunityFamily** → **ArticleBrief** → **compile ArticleDraft**. The **OFFLINE deterministic
   provider** (`DeterministicOfflineProviderAdapter`) produces Stage-1 content by a pure in-process
   hash (asserted deterministic + byte-identical on re-run, zero I/O); its opaque envelope pointer
   feeds the compile route.
9. **Quality / Platform / Vertical gates PASS** → **Article Approval CONFIRMED** (explicit human
   approver, server-derived identity).
10. **PublishPackage** (0 default channels) → a **human** selects one channel → **DistributionPlan**.
11. **PublicationReceipt**: a `system`/automatic actor is **rejected 422 and writes nothing**; only a
    real human actor is accepted (Automatic Publication = NO).
12. **Client Delivery Center** shows the DELIVERED article.
13. **Agency** sees **only** its ACTIVE-assigned client (never the unassigned second client).
14. **Ops** sees the full **Audit Trail**; every persisted `audit_event` carries its tamper-evidence
    `event_hash` and a real actor id.
15. **Tenant isolation**: a second client cannot read the first client's deliveries or knowledge
    package (403), and its own deliveries are empty (control).

---

## 2. Pilot invariants — asserted with real evidence

| Invariant | How it is proven | Result |
| --- | --- | --- |
| **Provider real calls = 0** | `PROVIDER_RUNTIME_ENABLED` resolves `false`; `assertRealProviderCallAllowed()` throws `ProviderRuntimeDisabledError`; the `provider_execution` ledger (migration 0007) has **0 rows**; the offline adapter has no network import; the persisted `provider_article_content` row stores exactly the opaque offline envelope pointer. | **0** |
| **Automatic Publication = NO** | A `system` actor on `POST /api/publication-receipts` → **422**, zero `publication_receipt` rows written; only the human actor is accepted. | **NO** |
| **Default Selected Channel Count = 0** | `publish-packages` response `channelNeutralContentPackage.selectedChannelCount === 0`; a human then selects exactly one channel. | **0** |
| **Real Customer Data = 0** | Every `organization.display_name` matches `Sample`/`Pilot Fixture`; every `user.email` uses a reserved non-routable test domain (RFC 2606/6761). | **0** |
| **Tenant + assignment isolation** | Cross-tenant reads → 403; the agency lists only its ACTIVE-assigned client. | **HOLDS** |
| **Audit actor integrity** | Every `audit_event` row has a non-empty `event_hash` and a non-null `actor_user_id`; the full domain action set is present. | **HOLDS** |

---

## 3. Resilience drills

| Drill | What it proves | Result |
| --- | --- | --- |
| **(a) Application restart** | The pool/runtime is closed (process gone, every in-process cache lost); a brand-new `createPgApplicationRuntime` over a fresh pool re-logs-in and reads back org / project / knowledge package + **uploaded DOCX text** / opportunity / delivery / audit trail, and re-derives the publication **state** (PUBLISHED). Business state, not just rows, survives. | **PASS** |
| **(b) Session-key rotation** | A cookie signed under key **K1** still verifies after rotation (K1→PREVIOUS, K2→CURRENT) during the window; a fresh login under **K2** works; after PREVIOUS is dropped, the old K1 cookie is **rejected**. Proven at the signing layer AND end-to-end through the real login route + `AuthRuntime.resolveSession`. | **PASS** |
| **(c) Backup + restore** | `scripts/backup/backup.mjs` `pg_dump`s the pilot db; `scripts/backup/restore.mjs` creates a FRESH throwaway db and `pg_restore`s into it; connecting to the restored db, all business state (accounts / knowledge text / opportunity / article draft / delivery / audit) is present and identical, and the restored append-only `delivery` trigger is live. Throwaway db + dump artifact are dropped. | **PASS** |

---

## 4. Gate results (this run)

| Gate | Command | Result |
| --- | --- | --- |
| Typecheck | `npx tsc --noEmit` | **PASS** |
| Pilot suites | `npx vitest run tests/pilot` | **PASS** — 4/4 (1 acceptance E2E + 3 resilience drills; both files ran, not skipped) |
| Whole suite | `npm test` | **PASS** — 815/815 across 81 files |
| Web build | `npm run build:web` | **PASS** |

---

## 5. Operator-gated items (NOT run here — require an operator to enable)

These two items are deliberately **out of scope for an unattended pilot QA run** and are clearly
gated; each must be executed by an operator in a controlled window:

1. **Real Provider micro-canary** — a single, budget-capped real model call to confirm the D2
   OpenAI-compatible adapter and the `provider_execution` ledger end-to-end. Requires
   `PROVIDER_API_KEY` set **and** `PROVIDER_RUNTIME_ENABLED=true`. It is intentionally **not** run in
   this suite (the pilot invariant is Provider real calls = 0). Status: **OPERATOR-GATED — NOT RUN**.
2. **Canonical PostgreSQL 16 verification** — `node scripts/backup/pg-verify.mjs` against a real
   PostgreSQL **16** instance. This environment runs PostgreSQL **18.3** and has no PG16 available, so
   the canonical PG16 verify is **OPERATOR-GATED — NOT RUN** here (a PG18-equivalent battery has been
   run — see `docs/pilot/BACKUP_RESTORE_NOTES.md`). Status: **OPERATOR-GATED — NOT RUN (needs a PG16
   instance)**.

---

## 6. Section-16 final-report fields (fill for sign-off)

| Field | Value |
| --- | --- |
| Pilot role E2E (pass/total) | **1 / 1** |
| Restart drill | **PASS** |
| Session-rotation drill | **PASS** |
| Backup/restore drill | **PASS** |
| Provider real calls | **0** |
| Automatic publication | **NO** |
| Default selected channel count | **0** |
| Real customer data | **0** (all fixtures desensitized) |
| Tenant + assignment isolation | **HOLDS** |
| Audit actor integrity | **HOLDS** |
| Typecheck | **PASS** |
| Web build | **PASS** |
| Whole test suite | **PASS (815/815)** |
| Real Provider micro-canary | **OPERATOR-GATED — NOT RUN** (needs `PROVIDER_API_KEY` + flag on) |
| Canonical PostgreSQL 16 verify | **OPERATOR-GATED — NOT RUN** (needs a PG16 instance; PG18.3 here) |
| Blockers | **none** |

---

## 7. Reproduce

```
# 1. Env (.env.local): GEO_TEST_DATABASE_URL=…/geoplane_pl_f ; SESSION_SIGNING_KEY_CURRENT=… ;
#    PROVIDER_RUNTIME_ENABLED=false
npm ci

# 2. Gates
npx tsc --noEmit
npx vitest run tests/pilot     # both suites run (skip only if no test DB configured)
npm test
npm run build:web
```

If no test database is configured, the pilot suites `describe.skipIf`-skip cleanly (they do not
fail). The backup/restore drill additionally needs `pg_dump`/`pg_restore` on PATH (or a known
PostgreSQL bin dir) and the `postgres` superuser reachable with the shared password.
