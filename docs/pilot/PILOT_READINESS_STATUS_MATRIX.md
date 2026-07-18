# PILOT READINESS STATUS MATRIX — section-14 PILOT_READY gate

Read-only supervisor verdict at pilot HEAD `3d2da9c` on branch
`audit/pilot-readiness-supervisor-v1`. This matrix maps the section-14 `PILOT_READY` gate items
to **PASS / PASS_WITH_CHANGES / BLOCKED**, with evidence, and states an overall verdict.

Scope note: no in-tree `section-14` specification document exists at this HEAD; the gate items
below are the `PILOT_READY` checklist as defined by the supervisor charter for
`PILOT_READINESS_AND_CONTROLLED_PROVIDER_V1`. The two known environment gates (PG16 not
installed; provider live micro-canary needs a real key) are recorded as
**BLOCKED_PENDING_OPERATOR** — operator-env gates, **not** failures of the build.

Verification performed: `npm ci` (exit 0), `tsc --noEmit` (clean), and targeted `vitest run`:
- 17 pure-logic suites — **209/209 pass** (auth-hardening, session-cookie, provider ×5,
  review ×2, staging logger/health-live/preflight, client-surface-leak, agency-client-isolation,
  workspace-boundaries).
- 5 DB-backed suites — **36/36 pass** (session-revocation, knowledge-audit route, review route,
  provider-ledger, health-ready).
- backup/restore E2E — **7/7 pass**.

Detail per area lives in `AUTH_SECURITY_AUDIT.md`, `PROVIDER_BOUNDARY_AUDIT.md`,
`STAGING_OPERATIONS_AUDIT.md` (siblings in this directory).

---

## Gate items

| # | PILOT_READY gate item | Status | Evidence (file:line / suite) |
|---|---|---|---|
| G1 | Session unforgeable (HMAC signed; tampered/expired/wrong-key/unsigned rejected) | **PASS** | `src/lib/session-signing.ts:213-220,246-287`; `session-cookie.ts:75-80`; signed-session-cookie.test.ts ✓ |
| G2 | Key rotation via PREVIOUS; fail-closed in production | **PASS** | `session-signing.ts:162-167,117-144`; key-rotation.test.ts ✓ |
| G3 | Server-side revocation + staleness + idle + cross-surface (no authz from a forgeable value) | **PASS** | `src/runtime/auth/runtime-context.ts:272-302`; session-revocation.pg.test.ts ✓ |
| G4 | No route trusts role/tenant from the client body | **PASS** | `api/commands/projects/route.ts:53-82`; `agency/clients/route.ts:44-54`; `agency/context/route.ts:22-34` + `auth-service.ts:405-423`; grep clean |
| G5 | CSRF/Origin guard covers all state-changing `/api` (cross-origin / origin-less mutation blocked) | **PASS** | `middleware.ts:47-70,101-111`; `src/middleware.ts:20-24`; `request-origin.ts:113-142`; csrf-origin.test.ts ✓ |
| G6 | Legacy knowledge routes audited — one audit_event each, server-derived actor | **PASS** | `knowledge/audit.ts:45-74`; `ingest-request.ts:87-100`; confirm/resolve/snapshots routes (1 call each); knowledge-audit.route.pg.test.ts ✓ |
| G7 | Client review exposes no raw UUID; forged opaque ref rejected | **PASS** | `OpportunityReviewControl.tsx:60-77`; `review-reference.ts:140-164`; `reviews/route.ts:109-119`; client-surface-leak.test.ts ✓ |
| G8 | Review is explicit CONFIRMED only — never silent auto-approve | **PASS** | `reviews/route.ts:6-8,129-139,185-199`; review-runtime.route.pg.test.ts ✓ |
| G9 | Review stale version → 409 CONFLICT (no write) | **PASS** | `reviews/route.ts:169-183`; review-runtime.route.pg.test.ts ✓ |
| G10 | Provider real call cannot bypass `PROVIDER_RUNTIME_ENABLED` (default OFF) | **PASS** | `feature-flag.ts:35-77`; `openai-compatible-adapter.ts:277-282`; adapter not wired into any reachable path; feature-flag.test.ts ✓ |
| G11 | Contract-validation firewall: model cannot produce governance/gate/approval/hash/publication | **PASS** | `contract-validation.ts:43-134,165-208`; `openai-compatible-adapter.ts:487-491`; contract-validation.test.ts ✓ |
| G12 | Provider cannot auto-approve / auto-publish | **PASS** | `records.ts:16-19`; no approval/publish surface in `runtime/provider/**` |
| G13 | API key cannot leak into record / log / error / ledger row | **PASS** | `openai-compatible-adapter.ts:293-296,415-424`; `records.ts` (no secret field); `pg-provider-ledger.ts:11-33,160-205`; `0007_provider_ledger.sql:24-36,66-139`; provider-ledger.pg.test.ts ✓ |
| G14 | Provider ledger append-only + idempotent (one row per call), tenant-scoped | **PASS** | `0007_provider_ledger.sql:45-49,137-162`; `pg-provider-ledger.ts:160-205,278-286`; provider-ledger.pg.test.ts ✓ |
| G15 | Backup + restore-to-fresh actually restores data (E2E) | **PASS** | backup-restore.e2e.test.ts:303-410 (**7/7**); `BACKUP_RESTORE_NOTES.md:48-61` |
| G16 | Health live/ready correct (live always 200 no-deps; ready 200/503, secret-free) | **PASS** | `health/live/route.ts:13-18`; `readiness.ts:74-90`; health-live.test.ts ✓, health-ready.pg.test.ts ✓ |
| G17 | Structured logger redacts cookie/token/key/knowledge/provider text | **PASS** | `logger.ts:77-128,154-192`; logger.test.ts ✓ |
| G18 | Deployment preflight blockers correct; migration version current (0007) | **PASS** | `preflight.ts:132-144,298-349,391-409`; preflight.test.ts ✓ (cosmetic "0006" comment nit — see STAGING audit §5) |
| G19 | Formal pages fixture-free (0 formal pages import `_fixtures`) | **PASS** | grep: 0 `_fixtures` imports in `src/app`; page.tsx mention is a comment |
| G20 | Tenant + agency-assignment isolation holds | **PASS** | agency-client-isolation.test.ts ✓; workspace-boundaries.test.ts ✓; `runtime-context.ts:289`; `pg-provider-ledger.ts:278-286` |
| G21 | Canonical PostgreSQL **16** verification | **BLOCKED_PENDING_OPERATOR** | PG16 not installed; `pg-verify.mjs` → BLOCKED_PENDING_ENV; PG18-equivalent battery PASS — `BACKUP_RESTORE_NOTES.md:63-93` |
| G22 | Provider **live micro-canary** (flag ON, real key) | **BLOCKED_PENDING_OPERATOR** | flag-on path built + unit-covered offline; requires operator-provisioned API key + deliberate wiring — see PROVIDER audit |

**REAL violations: 0.** No security or boundary defect was found. The only non-passing items
(G21, G22) are operator-environment gates, not build failures.

Non-blocking observations (not violations):
- Cosmetic stale "0006" comments in `src/app/api/health/ready/route.ts:6`,
  `src/runtime/observability/preflight.ts:298`, `scripts/preflight/preflight.mjs:122` — the
  logic derives the current migration version dynamically (0007), so behavior is correct.
- The review route accepts a raw `opportunityValidationId` internal/back-compat fallback
  (`reviews/route.ts:98,117-119`); it is tenant-validated and never sent by the client — not a
  client-surface leak.

---

## OVERALL VERDICT: **PASS_WITH_CHANGES**

The integrated pilot build is pilot-ready at the code level: **all 20 build-level gate items
(G1–G20) PASS with zero REAL violations**, `tsc` is clean, and every executed suite is green
(209 + 36 + 7 tests). The verdict is `PASS_WITH_CHANGES` rather than an unqualified `PASS`
solely because **two gate items remain `BLOCKED_PENDING_OPERATOR`** — G21 (canonical PG16
verification, awaiting a provisioned PG16 instance; PG18-equivalent evidence stands in) and G22
(provider live micro-canary, awaiting a real provider API key). Both are environment gates the
operator must close in the target deploy environment; neither reflects a defect in the build.
A one-line comment refresh of the three stale "0006" strings is recommended but non-blocking.

### Next single action
Provision a PostgreSQL 16 instance for the pilot and run `node scripts/backup/pg-verify.mjs`
to close G21 (it auto-detects PG16 and reports `PG16=PASS/FAIL`); then supply a real provider
key and run the flag-ON micro-canary to close G22.
