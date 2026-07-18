# API_AUTHORIZATION_AUDIT

Phase: `PRODUCT_RUNTIME_CLOSURE_V1` — Supervisor baseline (read-only static audit).
Product base: `21e36aa`. Method: static (read + grep). No code modified.

Scope: **every** route under `src/app/api/**` (18 handlers). For each: is tenant
resolution **server-derived**? does the handler **trust any client-supplied id**
for authorization? is the **audit actor** genuine/server-derived?

Severity: **BLOCKER / WARN / INFO**. Disposition: **REAL** vs **KNOWN-IN-PROGRESS**.

---

## 0. How authorization is derived (the shared spine)

All three lane runtimes resolve the session identically: the cookie is trusted
**only** to say *which user*; role / org / assignments are re-read from the
database.

- `resolveSession` decodes the cookie → `actorUserId`, then
  `sessions.listActiveByUser(actorUserId)` (query filters revoked/expired), then
  `organizations.findById(session.organizationId)`; role/orgType/assignments come
  from those DB rows — never from the cookie body.
  Evidence: `src/runtime/auth/runtime-context.ts:191-229`,
  `src/runtime/geo/runtime-context.ts:121-147`,
  `src/runtime/knowledge/runtime-context.ts:145-167`.
- Authorization predicates are server-side and fail-closed:
  `principalCanReadClientOrganization` (`geo/runtime-context.ts:72-81`),
  `principalOwnsClient` (`knowledge/runtime-context.ts:77-83`),
  `canAccessClientOrganization` (`auth/auth-service.ts:504`).
- Route scope (`clientOrganizationId`) is taken from the **DB-loaded project /
  package**, not from request input (`requireReadableProject`
  `geo/http-guards.ts:40-57`; `requireOwnedPackage` `knowledge/http-guards.ts:37-56`).

**Client-id-trust scan** (grep over `src/app/api` for `body.(organizationId|
clientOrganizationId|actingOrganizationId|role|actorOrganizationId)` and
`params.(organizationId|role)`): exactly **one** hit —
`agency/context/route.ts:24` reads `body.clientOrganizationId`. That value is a
*selection target*, re-validated server-side via
`isAgencyAuthorizedForClient(session.organizationId, …)`
(`auth-service.ts:419-435`) before use. **No route derives role/org for an
authorization decision from client input.**

### Documented scope caveat (WARN — applies to every route)

The session cookie is **not cryptographically signed** — a plain base64url JSON
blob, "trivially forgeable by anyone who can set a cookie"
(`src/lib/session-cookie.ts:20-30`). Authentication *integrity* is explicitly a
future checkpoint; a forged cookie naming a user who has an active session row
could be accepted by `resolveSession`. This is a **documented KNOWN-IN-PROGRESS**
limitation, not a silent authorization flaw: given an *authentic* principal, every
authorization decision below is correctly server-derived. It is called out here
because it caps the strength of every "server-derived: YES" cell.

---

## 1. Per-route table

Legend — Tenant resolution: **SRV** = server-derived from session+DB · **N/A** =
no tenant scope. Client-id trust: **NO** = none · **SEL** = client supplies a
selection target that is re-validated server-side. Audit actor: **SES** = written
from session identity · **DOM** = actor persisted on the domain row only (no
separate `audit_event`) · **none** = no write.

| Route | Method | Tenant res. | Client-id trust | Audit actor | Notes / evidence |
|---|---|---|---|---|---|
| `/api/auth/login` | POST | N/A (pre-session) | NO (email only) | none | body.email identifies user; creds out of scope. No audit_event on login. `auth/login/route.ts`, `auth-service.ts:249-308` |
| `/api/auth/logout` | POST | SRV | NO | none | revokes session by `session.sessionId`. `auth/logout/route.ts:18-21` |
| `/api/account` | GET | SRV | NO | none | `getAccount(session)`. `account/route.ts:16-20` |
| `/api/agency/clients` | GET | SRV | NO | none | agency-role-gated; returns ACTIVE-assigned only. `agency/clients/route.ts:16-20`, `auth-service.ts:364-393` |
| `/api/agency/context` | POST | SRV | **SEL** | **SES** | body.clientOrganizationId re-checked `isAgencyAuthorizedForClient`; emits ALLOWED/DENIED audit. `agency/context/route.ts:22-34`, `auth-service.ts:401-484` |
| `/api/invitations/[token]/accept` | POST | SRV | NO | none | uses `session.userId/email`; token from URL hashed server-side; email must match. `invitations/[token]/accept/route.ts:23-33` |
| `/api/projects` | GET | SRV | NO¹ | none | CLIENT→own org; AGENCY→assigned ids; PLATFORM→`?clientOrganizationId` (admin only). `projects/route.ts:29-37` |
| `/api/projects/[projectId]` | GET | SRV | NO | **SES** | `getProject` re-derives ctx from session; DENIED audit on cross-tenant. `projects/[projectId]/route.ts:26-34`, `auth-service.ts:492-542` |
| `/api/projects/[projectId]/keyword-questions` | GET | SRV | NO | none | `requireReadableProject`; scope from project. `.../keyword-questions/route.ts:26-37` |
| `/api/projects/[projectId]/opportunities` | GET | SRV | NO | none | `requireReadableProject`. `.../opportunities/route.ts:26-42` |
| `/api/projects/[projectId]/review-queue` | GET | SRV | NO | none | `requireReadableProject`. `.../review-queue/route.ts:27-43` |
| `/api/projects/[projectId]/deliveries` | GET | SRV | NO | none | `requireReadableProject`. `.../deliveries/route.ts:27-38` |
| `/api/projects/[projectId]/knowledge/packages` | POST | SRV | NO | **DOM** | scope from DB project; `createdByUserId = principal.userId`; no audit_event. `.../knowledge/packages/route.ts:51-66` |
| `/api/knowledge/packages/[id]` | GET | SRV | NO | none | `requireOwnedPackage`. `knowledge/packages/[id]/route.ts:24-39` |
| `/api/knowledge/packages/[id]/confirm` | POST | SRV | NO | **DOM** | `confirm(pkg.id, principal.userId)`; no audit_event. `.../confirm/route.ts:29-33` |
| `/api/knowledge/packages/[id]/files` | POST | SRV | NO | **DOM** | `requireOwnedPackage`; ingests under owned pkg; no audit_event. `.../files/route.ts:30-73` |
| `/api/knowledge/packages/[id]/urls` | POST | SRV | NO | **DOM** | pre-fetched bytes only (no network); no audit_event. `.../urls/route.ts:31-72` |
| `/api/knowledge/packages/[id]/issues` | GET | SRV | NO | none | `requireOwnedPackage`. `.../issues/route.ts:24-33` |

¹ For `PLATFORM_SUPER_ADMIN` only, `/api/projects` honours a `?clientOrganizationId`
query param (`projects/route.ts:34-36`). The **role** that unlocks it is
server-derived; a platform admin may read any org by design
(`MULTI_TENANT_ACCOUNT_MODEL_V1`). CLIENT/AGENCY callers never reach that branch.
Not a client-id-trust violation.

---

## 2. Findings

### 2.1 Tenant isolation — server-derived (PASS, with §0 caveat)
Every data route resolves the principal server-side and scopes to a DB-loaded
resource. No handler authorizes off a client-supplied org/role. **PASS.** Capped
only by the unsigned-cookie authentication caveat (§0, WARN, KNOWN-IN-PROGRESS).
Cross-tenant negative paths are covered by tests
(`tests/runtime/geo/geo-read-api.route.pg.test.ts`,
`tests/runtime/knowledge/knowledge-api.route.pg.test.ts`,
`tests/runtime/auth/account-auth.route.pg.test.ts` — names indicate coverage;
not re-run here).

### 2.2 Command API client-id trust (PASS / N/A)
The task notes command (write) routes are being added by Agent C. On this base the
only writes are: `agency/context`, `auth/login|logout`,
`invitations/accept`, and the four knowledge writes. **None** reads
`organizationId/clientOrganizationId/actingOrganizationId/role` from body/params
for an authorization decision (the one `agency/context` body id is a re-validated
selection target). **No REAL violation.** Command routes proper: **N/A — not yet
present.**

### 2.3 Audit actor integrity (mixed — one REAL coverage gap)
- **Genuine where written:** `agency/context` and `projects/[projectId]` persist
  `AuditIntent`s via `persistAuditIntents` → `recordAuditEvent`
  (`auth/runtime-context.ts:231-264`), with `actorUserId`/`actorOrganizationId`
  built **only** from the session (`auth-service.ts:212-234, 472-483`). The actor
  cannot be forged or omitted from client input, and the event carries a
  tamper-evidence `eventHash`. **PASS.**
- **GEO writes (pg root):** `PgAuditPort.record` persists actor from the
  service-supplied `AuditIntent` (session actor), hashed via `recordAuditEvent`
  (`pg-application-runtime.ts:131-158`). **PASS** (within the E2E root).
- **Gap (WARN, REAL):** the **knowledge write routes** (`create` / `confirm` /
  `files` / `urls`) and **`auth/login|logout`** persist the actor on the **domain
  row** (`createdByUserId` / `confirmedBy` = `principal.userId`) but do **not**
  emit a separate append-only `audit_event`. So not every business write produces
  an audit-log entry. The actor that *is* recorded is genuine and server-derived
  (no forgery risk), but audit **coverage** is incomplete versus the
  "every business write audits" ideal (`RUNTIME_COMPOSITION_ROOT.md` lists
  "KnowledgePackage Created" among the seven audited actions — realized only in the
  offline `KnowledgeService`, not in the D3 HTTP route). Severity **WARN**; REAL
  coverage gap, plausibly a later checkpoint's scope.

### 2.4 No forge/omit path for the actor (PASS)
`recordAuditEvent` is always called with `actorUserId` sourced from the resolved
session; there is no code path that lets a request body set the actor. Grep
confirms `recordAuditEvent` call sites are `auth/runtime-context.ts` and
`pg-application-runtime.ts` only.

---

## 3. Summary

| Invariant | Verdict | Disposition |
|---|---|---|
| Tenant resolution server-derived on every route | PASS | (capped by unsigned-cookie caveat) |
| No client-id trust for authorization | PASS | — |
| Command routes read ids from session not body | N/A | command routes not yet present |
| Audit actor genuine where written | PASS | — |
| Audit coverage on all business writes | WARN | REAL gap (knowledge writes + login/logout unaudited) |
| Unsigned session cookie (authentication) | WARN | KNOWN-IN-PROGRESS (documented) |

**No BLOCKER-level authorization violation found.**
