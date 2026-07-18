# HTTP_ROUTE_SMOKE_TEST

Phase: `REBUILD_INTEGRATION_ACCEPTANCE_V1`, section 八.
Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC (this report itself).

## Method

Real `next build` + `next start` on port 3417, then real `fetch()` HTTP
requests (`scripts/http-route-smoke-test.mjs`) with real `Cookie` headers
carrying the acceptance-phase session cookie from `src/lib/session-cookie.ts`
(see that file's header for the explicit "not production-grade auth"
caveat). No mocking, no in-process route invocation, no reliance on the
frontend's own nav-array unit tests — every check below is an actual HTTP
round trip against a running server, asserting on the real status code
received.

## Route-name mapping

This phase's spec section 8 names five routes that do not exist verbatim
in this codebase's actual built routes (they were named against an
idealized spec, not the routes C1-C6 actually built overnight). Rather
than silently 404 against a fabricated path, or add a new route to match
the name — `/app/visibility` in particular would be exactly the kind of
new "可见性真实监测" (real visibility monitoring) feature this phase's
own section 十三 explicitly **prohibits** adding — each was mapped to its
real, closest conceptual match and tested there instead:

| Spec-named route | Real route tested | Why |
|---|---|---|
| `/app/dashboard` | `/app` | `/app` is the client workspace's root/overview page — its dashboard, just not literally named that. |
| `/app/questions` | `/app/keywords` | "关键词与用户问题" (keyword & user-question) — the spec's "questions" is this page's second half. |
| `/app/visibility` | `/app/performance` | Per `docs/architecture/SYSTEM_BLUEPRINT_V1.md`, "visibility" is an explicit P4 (lowest-priority) placeholder module, distinct from and not yet built alongside "效果验证" (performance validation, P2/post-delivery) — `/app/performance` is the closest real page; no `/app/visibility` route exists, and building one now would violate section 十三. |
| `/agency/clients` | `/agency/projects` | "客户项目" (client projects) is the built page's actual name. |
| `/agency/reviews` | `/agency/review-queue` | Exact same page, different literal path spelling. |

## Results — 23/23 checks passed

**1. Legitimate identity → 200 on its own surface** (14 checks): every
real client, agency, and ops route returned 200 for a session with the
matching role, plus `/login` reachable with no session at all.

**2. 未登录访问受保护页面被拒绝** (3 checks): `/app`, `/agency/templates`,
`/ops/organizations` each redirected (302) to `/login` with zero session
cookie — a real HTTP redirect, not a client-side check a direct API call
could bypass.

**3. Client 访问 Agency 被拒绝** (1 check): a `CLIENT_OWNER` session
hitting `/agency/templates` → real HTTP **403**.

**4. Agency 访问 Ops 被拒绝** (1 check): an `AGENCY_OWNER` session hitting
`/ops/organizations` → real HTTP **403**.

**5. Full pairwise cross-surface matrix** (4 checks, beyond what the spec
explicitly named): `CLIENT_OWNER`→`/ops`, `AGENCY_OWNER`→`/app`,
`PLATFORM_SUPER_ADMIN`→`/app`, `PLATFORM_SUPER_ADMIN`→`/agency` — every
combination not already covered by checks 3-4 also returns 403. (Note:
in this middleware, `PLATFORM_SUPER_ADMIN`'s home surface is `/ops` only —
platform-wide read access to `/app`/`/agency` data is proven separately at
the service layer, e.g. `listOrganizations`/`opsAuditTrail` in
`tests/composition/application-composition-root.test.ts` — not modeled as
HTTP route access into those two surfaces' own UI, which stays reserved
for their own role tiers per this codebase's nav-isolation design.)

**6. Client A 访问 Client B 被拒绝** — not directly testable as an HTTP
route check, and said so explicitly rather than fabricating a false
result: **no route in this codebase accepts a foreign client-organization
id as a path or query parameter** — every `/app/*` route is implicitly
scoped to the current session's own `activeClientOrganizationId`. There is
no HTTP endpoint through which Client A could even address Client B's
data; the isolation is structural, not merely checked-and-denied. This
exact scenario **is** exercised with a real assertion at the
service/read-model layer — see
`tests/composition/application-composition-root.test.ts`, third test case
("a client outside this scope cannot read this client's delivery center
through the read model").

## Command

```
next build && next start -p 3417 &
node scripts/http-route-smoke-test.mjs
```

Full raw output: 23/23 `PASS`, `ALL CHECKS PASSED`. Server process
terminated (port 3417 freed) after the run completed.
