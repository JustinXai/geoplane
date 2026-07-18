# API_AUTHORIZATION_AUDIT

Phase: `PRODUCT_RUNTIME_CLOSURE_V1` — Supervisor **re-audit of the INTEGRATED runtime** (cycle 1 + 2).
Product base: `12a727a`. Method: static (read + grep). No source modified.

Scope: all `src/app/api/**` route handlers (39 route files; **27 with a write
handler**). For each write route: server-derived tenant? client-id trust? audit_event?

Severity: **BLOCKER / WARN / INFO**. Disposition: **PASS** · **IN_PROGRESS** · **GAP**.

---

## 0. Shared spine (unchanged, extended by the command lane)

Session resolution still trusts the cookie **only** for `actorUserId`; role / org /
assignments are re-read from the DB (`auth/runtime-context.ts:191-229`,
`geo/runtime-context.ts:121-147`, `knowledge/runtime-context.ts:145-167`).

The new **command lane** centralises write-side tenancy + audit in shared helpers, so
a business write structurally cannot skip either:

- `requireSession` — cookie → server-resolved `AuthenticatedSession`, else 401
  (`runtime/commands/geo-command-http.ts:29-38`).
- `sessionCanAccessClientOrganization(session, clientOrgId)` — PLATFORM any / CLIENT
  own / AGENCY assigned-only (`runtime/commands/geo-command-runtime.ts:388-400`).
- `denyIfCrossTenant` — on failure persists a **DENIED** audit event (real actor) and
  returns 403 (`geo-command-http.ts:45-64`).
- `runWriteCommand` — runs the write in one transaction and appends exactly one
  **ALLOWED** audit event via `appendAudit` (`runtime/commands/runtime-context.ts:169-204,
  106-141`); `recordDeniedCommand` for admin/ops denials (`:211-221`). GEO domain
  services additionally emit their own `AuditIntent`s through `PgCommandAuditPort.record`
  (`geo-command-runtime.ts:141-169`).
- `buildGeoAuthorizationContext(session)` — identity/grants come only from the session
  (`geo-command-runtime.ts:365-379`).

**Client-id-trust scan** over `commands/**`, `ops/**`, and the GEO write routes for
`body.(organizationId|clientOrganizationId|actingOrganizationId|actorOrganizationId|role)`
/ `params.(organizationId|role)` → **no hit trusted for authorization** (details §2.1).

### Documented scope caveat (WARN — unchanged, applies to every route)
The session cookie is still an unsigned base64url JSON blob, "trivially forgeable"
(`src/lib/session-cookie.ts:11-18`). Authentication *integrity* remains a future
checkpoint; every "server-derived" verdict below is correct **given an authentic
principal**. IN_PROGRESS, documented — not a silent flaw.

---

## 1. Write routes (27) — server-derived tenant + audit_event

All write handlers derive the tenant from the **session** or from a **DB-loaded
resource**, authorize via `denyIfCrossTenant` (GEO chain) or an inline
`role/assignment` check (admin/ops), and emit an audit_event on both the ALLOWED and
DENIED paths. Representative evidence:

| Route (POST) | Tenant derivation | Authz guard (file:line) | audit_event |
|---|---|---|---|
| `commands/agency/clients` | agency = `session.organizationId` | role check → 403 (`route.ts:46-54`) | DENIED `:47` + ALLOWED `runWriteCommand` |
| `commands/projects` | CLIENT pinned to own; AGENCY body id validated vs `session.assignedClientOrganizationIds`; PLATFORM verified in-tx | assignment check → 403 (`route.ts:64-69`) | DENIED `:65` + ALLOWED |
| `commands/projects/[projectId]/enterprise-profile` | DB project → `project.clientOrganizationId` (`route.ts:56-58`) | `denyIfCrossTenant` (`:60`) | DENIED + ALLOWED |
| `commands/projects/[projectId]/keyword-maps` | DB project; KP + IndustryProfile re-checked same tenant | `denyIfCrossTenant` (`:76`) | DENIED + ALLOWED |
| `commands/projects/[projectId]/knowledge-packages` | DB project (`:53-55`) | `denyIfCrossTenant` (`:57`) | ALLOWED + **domain** `knowledge_package.created` (`geo-command-runtime.ts:309`) |
| `commands/projects/[projectId]/knowledge-packages/[id]/confirm` | DB project; package re-verified | `denyIfCrossTenant` (`:63`) | ALLOWED + **domain** `knowledge_package.confirmed` (`geo-command-runtime.ts:328`) |
| `commands/projects/[projectId]/opportunities` | DB project; map/pkg/profile from referenced map | `denyIfCrossTenant` (`:56`) | DENIED + ALLOWED |
| `ops/agencies` / `ops/clients` / `ops/assignments` | actor from session; ops targets validated in-tx | role `!== PLATFORM_SUPER_ADMIN` → 403 | DENIED + ALLOWED |
| `article-briefs` | tenant from referenced OpportunityFamily (`:81-90`) | `denyIfCrossTenant` (`:91`) | DENIED + ALLOWED |
| `article-drafts/compile` | tenant from referenced ArticleBrief (`:62-71`) | `denyIfCrossTenant` (`:72`) | DENIED + ALLOWED |
| `article-drafts/[id]/reviews` | tenant from persisted ArticleDraft; approver = `actor.userId` | `denyIfCrossTenant` (`:65`) | DENIED + ALLOWED |
| `opportunities/[id]/reviews` | tenant from persisted Opportunity; reviewer = `actor.userId` | `denyIfCrossTenant` (`:75`) | DENIED + ALLOWED |
| `opportunity-families` | DB project by body `projectId` → `clientOrganizationId` (`:88-90`) | `denyIfCrossTenant` (`:92`) | DENIED + ALLOWED |
| `publish-packages` | tenant from referenced ArticleApproval (`:84-93`) | `denyIfCrossTenant` (`:94`) | DENIED + ALLOWED |
| `distribution-plans` | tenant from referenced ChannelNeutralContentPackage (`:69-78`) | `denyIfCrossTenant` (`:79`) | DENIED + ALLOWED |
| `publication-receipts` | tenant from referenced DistributionPlan (`:63-72`) | `denyIfCrossTenant` (`:73`) | DENIED + ALLOWED |
| `projects/[projectId]/invitations` | invited org = `project.clientOrganizationId` (`:69-73`) | `canInviteForClientOrg` (`:39-54,75`) | DENIED `:76` + ALLOWED |
| `agency/context` | body clientOrgId re-checked `isAgencyAuthorizedForClient` | `auth-service.ts:419-435` | ALLOWED/DENIED intents |
| knowledge lane writes (`knowledge/packages/[id]/{confirm,files,urls}`, `projects/[projectId]/knowledge/packages`) | `requireOwnedPackage` / DB project; actor = `principal.userId` | `principalOwnsClient` (`knowledge/http-guards.ts:48`) | see §2.3 |

GET reads: the two cross-tenant ops reads are platform-admin gated —
`ops/organizations` and `ops/audit` both `session.role !== "PLATFORM_SUPER_ADMIN"` → 403
(`ops/organizations/route.ts:21-25`, `ops/audit/route.ts:28-32`).

---

## 2. Findings

### 2.1 Command API client-id trust (PASS — was N/A at baseline)
No write route trusts a client-supplied org id or role for authorization. Three read
body ids, all correctly gated, none an authz input:
- `commands/projects` reads `body.clientOrganizationId` but ignores it for CLIENT,
  validates it against `session.assignedClientOrganizationIds` for AGENCY, and
  existence/type-checks it in-tx for PLATFORM (`commands/projects/route.ts:55-99`).
- `ops/assignments` reads `agencyOrganizationId`/`clientOrganizationId` as operation
  *targets*; caller authority is the PLATFORM role check (`ops/assignments/route.ts:37`).
- **INFO (provenance, not authz):** `distribution-plans` reads `selectedByActorId`
  (`:49`) and `publication-receipts` reads `publishedByActorId` (`:52`) from the body
  as domain "who selected/published" fields. These are **not** tenancy/role inputs and
  are **not** the audit-event actor (which stays session-derived). `publishedByActorId`
  is additionally CHECK-constrained against automatic/system sentinels
  (`publication-receipts/route.ts` guard + `0004:487-490`). Worth flagging as data
  provenance only.

### 2.2 Audit-event coverage on business writes (PASS — baseline GAP 9b CLOSED)
Every command write emits an audit_event unconditionally (ALLOWED in `runWriteCommand`
`runtime-context.ts:193`; DENIED in `denyIfCrossTenant`/`recordDeniedCommand`). The
knowledge create/confirm audit gap flagged at baseline is closed: the command route
`commands/projects/[projectId]/knowledge-packages` routes through
`geo.createKnowledgePackage`, which emits `knowledge_package.created`
(`geo-command-runtime.ts:302-320`), and the confirm command emits
`knowledge_package.confirmed` (`:322-339`).

### 2.3 Legacy knowledge lane writes still lack a dedicated audit_event (WARN — residual)
The original D3 knowledge routes (`knowledge/packages/[id]/{confirm,files,urls}`,
`projects/[projectId]/knowledge/packages`) run on `getKnowledgeRuntime()`, not the
command lane. They persist the actor on the domain row (`createdByUserId` /
`confirmedBy` = `principal.userId`) but emit no separate `audit_event`. The audited
path now exists via the command route (§2.2), so these legacy routes are a
duplicate/uncanonical surface. **WARN, GAP (REAL):** the audited creation exists, but
two parallel knowledge-write surfaces do — one audited, one not; ingestion (files/urls)
has no audited command equivalent at all.

### 2.4 No forge/omit path for the audit actor (PASS)
The audit actor (`actorUserId` / `actorOrganizationId`) is always the session
principal — `CommandActor` is built from `session` at every route
(`{ userId: session.userId, organizationId: session.organizationId }`) and passed to
`recordAuditEvent`. No route lets request input set the actor.

### 2.5 No auto-approve (PASS — both gates)
- **Human review** (`opportunities/[id]/reviews`): the only path to an APPROVED
  decision is an explicit `decision: "CONFIRMED"`; a missing/omitted decision is 422,
  never a default; `CHANGES_REQUESTED`/`REJECTED` require a note; append-only
  (`route.ts:85-103, 130-143` + header `:8-14`).
- **Article approval** (`article-drafts/[id]/reviews`): approval requires a real
  approver AND all three gates PASSED; any FAILED gate → 422 with reasons and **no**
  approval written (`route.ts:120-135`). DB backstop: `ck_article_approval_no_silent_approve`
  (`0004:338`).

---

## 3. Summary

| Invariant | Verdict | Disposition |
|---|---|---|
| Server-derived tenant on ALL command routes | PASS | — |
| No client-id trust for authorization (command lane) | PASS | (was N/A) |
| audit_event emitted on business writes incl. knowledge | PASS | (baseline 9b closed) |
| No auto-approve (human review + article approval) | PASS | + DB CHECK backstop |
| Audit actor genuine & server-derived | PASS | — |
| Agency assignment isolation on writes | PASS | `sessionCanAccessClientOrganization` |
| Legacy knowledge lane writes lack dedicated audit_event | WARN | GAP (REAL) — duplicate uncanonical surface |
| body-supplied `selectedByActorId`/`publishedByActorId` provenance | INFO | not authz, not the audit actor; CHECK-constrained |
| Unsigned session cookie (authentication) | WARN | IN_PROGRESS (documented) |

**No BLOCKER-level authorization violation.** One residual WARN (legacy knowledge
writes on the non-command runtime are unaudited / duplicate the audited command).
