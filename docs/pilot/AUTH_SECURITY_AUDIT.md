# AUTH SECURITY AUDIT — PILOT_READINESS_AND_CONTROLLED_PROVIDER_V1

Read-only supervisor audit of the integrated pilot runtime at pilot HEAD `3d2da9c`.
Branch: `audit/pilot-readiness-supervisor-v1`. Scope: session integrity, server-side
authorization, CSRF, knowledge-audit closure, and the client review boundary.

Evidence classes: **REAL** (a genuine defect), **KNOWN-ENV-GATE** (blocked only by the
deploy environment, documented), **documented-future** (deliberately deferred). This audit
found **0 REAL violations** in the auth surface. All citations are `file:line` at HEAD.

Corroboration: the pure-logic auth/review/leak suites (209 tests across 17 files) and the
DB-backed suites (session-revocation, knowledge-audit, review-route — 36 tests) were executed
and **all pass**; `tsc --noEmit` is clean.

---

## 1. Is the session forgeable? — **NO**

The session cookie is HMAC-SHA256 signed with an absolute expiry; a hand-forged, tampered,
expired, or wrong-key cookie fails verification and is treated as "no session".

- Signing over the canonical bytes: `signSessionCookieValue` computes
  `HMAC-SHA256(payloadB64Url.issuedAt.expiresAt)` — `src/lib/session-signing.ts:213-220`,
  `184-186`.
- Verification recomputes and compares in **constant time** (`timingSafeEqual`,
  length-checked) — `src/lib/session-signing.ts:189-194`, `269-278`.
- Rejects every bad shape by returning `null` (never throws): wrong segment count, empty
  payload, non-finite timestamps, and **expiry enforced after the signature** so a
  valid-signature-but-past-TTL token is still rejected — `src/lib/session-signing.ts:250-286`.
- `decodeSessionCookie` returns `null` for any missing/tampered/expired/wrong-key/malformed
  value; a plain unsigned base64 JSON blob fails signature verification —
  `src/lib/session-cookie.ts:75-80`.
- **Rotation via PREVIOUS key**: a signature is accepted iff it matches `CURRENT` or (when
  set) `PREVIOUS`; any other key is rejected — `src/lib/session-signing.ts:162-167`,
  `270-278`. Contract documented at `src/lib/session-signing.ts:18-42`.
- **Fail-closed in production**: a missing `SESSION_SIGNING_KEY_CURRENT` throws when first
  needed in production; the insecure dev fallback is confined to non-production with a
  one-time warning that never prints the key — `src/lib/session-signing.ts:117-144`.

Verified by `tests/runtime/auth-hardening/signed-session-cookie.test.ts`,
`.../key-rotation.test.ts`, `tests/session-cookie.test.ts` (all pass).

## 2. Is any authorization decision taken from an unsigned/forgeable value? — **NO**

Authorization facts are re-derived **server-side** from the persisted `Session` +
`Organization`; the cookie only asserts *which user*.

- `resolveSession` loads the server-side session row for exactly the org the cookie claims,
  then enforces, against the loaded row: **idle-TTL** (from the signed `issuedAt`),
  **revocation / absolute expiry / staleness** (`isSessionValid` vs. the live
  membership version), and a **cross-surface guard** (cookie role must map to the same
  workspace surface as the server role) — `src/runtime/auth/runtime-context.ts:272-302`.
- A still-cryptographically-valid cookie cannot bypass server-side revocation or a role
  change — `src/runtime/auth/runtime-context.ts:19-23`, `285-302`.
- Cross-organization presentation finds no row (`loadLatestSessionForUserOrg` keyed on
  `user_id AND organization_id`) — `src/runtime/auth/runtime-context.ts:214-255`, `289`.

Verified by `tests/runtime/auth-hardening/session-revocation.pg.test.ts` (pass).

## 3. Is the role trusted from the client body? — **NO**

Every command route derives `role` and the acting organization from the session, never from
the request body. Where a body `clientOrganizationId` is read, it is always an
authorization-checked *selector*, not a trusted grant.

- `POST /api/commands/projects`: `CLIENT_OWNER` is pinned to their own client org (body value
  **ignored**); `AGENCY_*` may only name a client **in the session's ACTIVE assignment set**
  (else 403 + DENIED audit); `PLATFORM` names an org whose existence/type is verified in-txn —
  `src/app/api/commands/projects/route.ts:53-82`, `93-99`.
- `POST /api/commands/agency/clients`: `agencyOrganizationId` is **always** `session.organizationId`
  (never body); non-`AGENCY_OWNER` → 403 + DENIED — `src/app/api/commands/agency/clients/route.ts:44-54`.
- `POST /api/agency/context`: reads body `clientOrganizationId` but `setAgencyContext`
  enforces `isAgencyAuthorizedForClient` before acting (403 + DENIED otherwise) —
  `src/app/api/agency/context/route.ts:22-34`, `src/runtime/auth/auth-service.ts:405-423`.
- Cross-tenant pre-flight guard for geo commands resolves the tenant from the session or the
  loaded artifact, never a body value — `src/runtime/commands/geo-command-http.ts:40-64`.

A repo-wide grep for `body.role` / `body.organizationId` / `readStringField(body,"role")` in
`src/app/api` returned no client-trusted authorization read.

## 4. CSRF: does the middleware cover state-changing `/api` requests? — **YES**

- The middleware matcher includes `/app`, `/agency`, `/ops`, **and** `/api/:path*` —
  `middleware.ts:101-111`; the Next.js `src/`-convention wiring re-exports it with an
  identical inline matcher and `runtime = "nodejs"` — `src/middleware.ts:20-24`.
- `csrfOriginGuard` runs **first**, for every matched request, before any handler or role
  check — `middleware.ts:64-70`.
- For `POST/PUT/PATCH/DELETE`, the request must carry an `Origin` (or `Referer`) whose origin
  matches the target host or an `APP_ALLOWED_ORIGINS` entry; a mismatched, missing, or opaque
  (`"null"`) origin **fails closed** with a 403 — `src/lib/request-origin.ts:113-142`,
  `middleware.ts:47-62`. The body is never trusted for origin — `src/lib/request-origin.ts:16-20`.
- `GET/HEAD/OPTIONS` are exempt, so read/health routes are untouched —
  `src/lib/request-origin.ts:33-35`, `117-119`.

No mutating route sits outside the matcher. Verified by
`tests/runtime/auth-hardening/csrf-origin.test.ts` (pass).

## 5. Legacy knowledge routes audited? — **YES (each emits exactly one audit event, server-derived actor)**

The shared helper attributes the actor from the server-derived `KnowledgePrincipal` and the
client-org/project from the loaded resource — never request input —
`src/runtime/knowledge/audit.ts:10-19`, `45-74`.

| Legacy route | Audit action | One event |
| --- | --- | --- |
| file upload (`.../files`) | `knowledge.document.ingested` | via `ingestIntoPackage` — `src/runtime/knowledge/ingest-request.ts:87-100` |
| url import (`.../urls`) | `knowledge.url.ingested` | same shared path — `src/app/api/knowledge/packages/[id]/urls/route.ts:65-76` |
| package confirm (`.../confirm`) | `knowledge_package.confirmed` | `.../confirm/route.ts:39` (1 call) |
| issue resolve (`.../issues/[id]/resolve`) | resolve action | `.../resolve/route.ts:54` (1 call) |
| snapshot create (`.../snapshots`) | snapshot action | `.../snapshots/route.ts:63` (1 call) |

A SKIPPED ingest persists no version and emits no audit (correct) —
`src/runtime/knowledge/ingest-request.ts:75-100`. Verified by
`tests/runtime/knowledge-audit/knowledge-audit.route.pg.test.ts` (pass).

## 6. Client review boundary

**Exposes a raw UUID on the client body? — NO.** The client sends only the opaque
`reviewReferenceCode` + the version it read + the decision + an optional note — never a
reviewer/actor/org id or internal UUID — `src/components/client-runtime/OpportunityReviewControl.tsx:60-77`.
The reference is `base64url(validationId).HMAC-SHA256(...)`; the raw UUID never appears in
clear text — `src/runtime/geo/review-reference.ts:9-14`, `140-143`. A forged/tampered code
fails constant-time verification and decodes to `null` — `src/runtime/geo/review-reference.ts:150-164`;
the route then refuses the write (never falls through to a default id) —
`src/app/api/opportunities/[id]/reviews/route.ts:109-119`.

**Can it silently auto-approve? — NO.** Only an explicit `decision: "CONFIRMED"` yields an
APPROVED human-review outcome; there is no default/omission path, and `CHANGES_REQUESTED` /
`DEFERRED` require a note (DEFERRED records a held, non-approved decision) —
`src/app/api/opportunities/[id]/reviews/route.ts:6-8`, `129-139`, `185-199`. The UI offers the
three-state decision only, with no boolean "approve" —
`src/components/client-runtime/OpportunityReviewControl.tsx:3-17`, `27-45`.

**Stale version → 409.** Optimistic concurrency recounts prior decisions for the validation
inside the transaction; a stale `reviewVersion` throws `CONFLICT` with no write —
`src/app/api/opportunities/[id]/reviews/route.ts:169-183`.

No client view-model leaks a UUID or internal vocabulary — asserted by
`tests/runtime/client-workspace/client-surface-leak.test.ts` (pass); the review route is
exercised by `tests/runtime/review/review-runtime.route.pg.test.ts` (pass).

Note: the route additionally accepts a raw `opportunityValidationId` as an internal/back-compat
fallback (`.../reviews/route.ts:98`, `117-119`) — this is **not** a client-surface leak (the
client control never sends it) and the id is still tenant-validated before use
(`.../reviews/route.ts:156-167`). Classified **documented-future / internal**, not a violation.

---

## Verdict — AUTH SURFACE: PASS (0 REAL violations)

Session integrity, server-side authorization, CSRF coverage, knowledge-audit closure, and the
client review boundary all hold under code review and executed tests. No forgeable-value
authorization path was found; no route trusts role/tenant from the body.
