# LOCAL FUNCTIONAL AUDIT — FIRST READ-ONLY REVIEW

Audit scope: static review of the three-role pilot and existing authorization/publication behavior.

Decision: **BLOCKED**

`REMOTE_WRITE_ATTEMPTS = 0`

## Reviewed functional delta

`local/functional-pilot-v1` was reviewed at `fb1423e541d55dd0e8d1da77f70960d69ae27b4c`.

Changed files:

- `scripts/local/functional-pilot.mjs`
- `tests/local-staging/functional-pilot-runner.test.ts`

The runner wraps the existing `tests/pilot/pilot-acceptance.e2e.pg.test.ts`; the existing test itself is inherited from `main`.

## Capability matrix

| Capability | First-round result | Static evidence / limit |
| --- | --- | --- |
| Exact loopback test DB containment | STATIC_OK | Runner requires `geoplane_local_test` and loopback before spawning Vitest |
| Provider runtime OFF | STATIC_OK for this runner | Explicit false required; canary flag refused; known Provider keys stripped |
| Three sanitized role fixtures | STATIC_OK | Reserved test-domain identities and sample organization names |
| Platform/Client/Agency signed sessions | STATIC_PRESENT | Login route is invoked; credential verification is absent |
| Real PostgreSQL | STATIC_PRESENT | Pg pool/repositories and migrations are used; no run performed |
| HTTP route coverage | PARTIAL | Real Next route functions receive `Request` objects, but no live server/network request is used |
| Full business chain | STATIC_PRESENT | Route sequence covers knowledge through delivery and audit |
| Client tenant isolation | STATIC_PRESENT | Client B receives 403 for Client A delivery and knowledge reads |
| Agency assignment isolation | STATIC_PRESENT | Agency portfolio is asserted to exclude unassigned Client B |
| Human opportunity review | STATIC_PRESENT | Reviewer derives from session; explicit `CONFIRMED` required |
| Human article approval | STATIC_PRESENT | Approver derives from session and three gates must pass |
| Automatic publication OFF | BLOCKED | Sentinel labels rejected, but body-supplied actor can be spoofed |
| Default selected channel count zero | STATIC_PRESENT | Publish package starts with zero; later explicit plan selects one |
| Audit actor integrity | BLOCKED | Audit actor is session-derived, but plan/receipt actor fields are body-controlled |
| Live-server login and health | NOT_VERIFIED | No local start implementation or live request run |
| Functional test execution | NOT_VERIFIED | Static review only |

## Blocking findings

### FUN-01 — Three-role login is impersonable

The login route establishes a session from an email lookup alone. The functional pilot proves that three emails can obtain sessions, but it does not prove authenticated login. Until a credential is verified and negative-login cases pass over HTTP, Platform/Agency/Client login readiness is **BLOCKED**.

### FUN-02 — Manual distribution/publication evidence can be forged

The test submits `selectedByActorId: clientOwnerUser` and `publishedByActorId: clientOwnerUser`, but the production routes do not derive those values from the session. A test that supplies the expected value cannot prove the route rejects a spoofed value. This blocks Automatic Publication and Audit Actor Integrity.

Required negative tests:

- omit the actor field and prove the server uses the session actor, or remove the field from the public contract;
- submit a different user ID and an arbitrary service-looking ID and prove both cannot override the session identity;
- verify the distribution/publication durable actor equals the associated audit actor.

### FUN-03 — The runner is route-handler E2E, not live-server HTTP E2E

`tests/pilot/pilot-acceptance.e2e.pg.test.ts:263,278` invokes imported Next route functions directly with `Request` objects. This is stronger than bypassing routes through internal services and covers cookies, request parsing, authorization, and PostgreSQL. It does not prove Next server startup, routing/middleware behavior, port binding, or real network HTTP. A live local start plus HTTP E2E remains **NOT_VERIFIED**.

### FUN-04 — Some account/bootstrap operations bypass public routes

The scenario inserts initial users/memberships directly and creates a second invitation directly because the public invitation route deliberately does not return the raw token. This is acceptable as test provisioning evidence but is not proof that an operator can provision all three usable accounts end to end through the staged environment. The missing sanitized seed/account workflow remains **BLOCKED**.

### FUN-05 — Static post-run evidence overstates automatic-actor assurance

The runner's aggregate query recognizes only four automatic publication strings. It does not establish that the recorded distribution/publication actor is the authenticated session actor. It also checks that approvals/reviews have non-null actor IDs, not that every actor corresponds to the authenticating human for that request. The route-level binding must be fixed before aggregate evidence can be trusted.

## Positive static observations

- The destructive pilot is constrained to the exact local test database before the child test starts.
- The offline deterministic adapter has no network path, and the runner requires zero provider ledger execution rows.
- Client tenant checks cover both delivery and knowledge reads; agency list isolation covers an unassigned second client.
- Opportunity review and article approval routes derive reviewer/approver from the session and require explicit successful actions.
- Publish package construction starts with zero selected channels.
- Fixture identities use reserved test domains and sample markers.

## Not executed

No tests, application start, login, health request, database query, Provider call, restart, session rotation, backup, or restore was executed by the Supervisor. All dynamic outcomes are **NOT_VERIFIED**.

## Required disposition

Functional readiness remains **BLOCKED** until login credentials and actor binding are fixed, a sanitized operator provisioning flow exists, the committed integration environment can start, and both route-handler/database tests and live-server HTTP gates pass without Provider access.
