# MINIMAL_RUNTIME_E2E

Phase: `REBUILD_INTEGRATION_ACCEPTANCE_V1`, section 九.
Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC (this report itself).

## What was missing to run this scenario at all

Section 5's composition-root test (`tests/composition/application-composition-root.test.ts`)
already proved the full GEO chain end-to-end, but it created a
`CLIENT_OWNER` membership directly. This section's exact scenario
specifically requires "邀请 Client Owner → Client Owner 登录" (invite the
Client Owner, then the Client Owner logs in) — and no B checkpoint built
that transition. B4 only issues/revokes invitations; nothing turns a
`PENDING` invitation into a live session.

Added `src/composition/onboarding.ts` —
`acceptInvitationAndLogIn(tenancyRepository, invitation, organization,
acceptingUserId, now)`. Deliberately placed in `src/composition/`, not in
`src/contracts/tenancy/*.ts`: this phase's section 一 freezes
`TENANCY_AUTH_OFFLINE_FOUNDATION_V1`, so B's own files are composed, not
extended further for this. It:

1. Genuinely checks the invitation is usable via B4's own
   `isInvitationUsable` (an expired-but-still-PENDING invitation is
   correctly rejected — the same logic B4 already established, not
   re-derived here).
2. Creates the real `Membership` the invitation grants, via B5's
   `createMembership` — which enforces the one-active-client-org
   invariant exactly as it does for any other membership call.
3. Issues a real `Session` via B4's `issueSession`.
4. Records an `invitation.accepted` audit event.

**Scope note stated plainly**: `InMemoryTenancyRepository` has no method
to persist an invitation's status transition (only issue/revoke exist —
no generic "update" path, consistent with B5's append-only design).
"Accepting" is therefore modeled as its real-world *effect* (a new
Membership + Session), not as a stored `PENDING → ACCEPTED` mutation on
the `Invitation` record itself. This is a real, documented limitation,
not a silent gap.

## The scenario, run exactly as named

`tests/e2e/minimal-runtime-e2e.test.ts`, one continuous test: Platform
Admin creates an Agency → Agency's Client is created → Project created →
Client Owner invited → Client Owner accepts and logs in → KnowledgePackage
created → KeywordQuestionMap fixture generated → Opportunity created →
Human Review CONFIRMED → OpportunityFamily generated → ArticleBrief
generated → ArticleDraft compiled → all three gates PASSED → Human
Article Approval → PublishPackage created → `DistributionPlan` proven to
require an explicit human channel selection (never 0-by-default) →
`PublicationReceipt` created by a real human actor → visible in all three
workspaces' read models.

**Result: PASS.** Both tests in the file pass — the full scenario, plus a
dedicated type-level proof that a 0-channel `DistributionPlan` cannot even
be constructed in this exact scenario's own code.

## Ops Audit shows the complete, exact, ordered chain

The test asserts the full audit trail in exact order, not just presence:

```
invitation.issue → invitation.accepted → knowledge_package.created →
opportunity.created → human_review.confirmed → article.approved →
publish_package.created → publication_receipt.recorded
```

Eight real audit events for eight real actions — nothing missing,
nothing extra, nothing out of order.

## Constraint verification

- **Provider Calls = 0**: the entire scenario ran through in-memory
  repositories only. No `fetch`/`http`/provider-SDK import exists
  anywhere in the composition or contracts modules this test touches
  (independently proven at the module level by
  `tests/contracts/geo-business-compiler.test.ts` and
  `geo-business-quality-gate.test.ts`'s own static import scans; this
  test's successful completion with zero network setup of any kind is
  the integration-level corroboration).
- **Production Database Writes = 0**: no database driver import anywhere
  in this dependency chain — everything is Map-backed.
- **Automatic Publication = NO**: the receipt's actor is a real human id
  (`user_client_owner`), asserted directly not to be
  `system`/`auto`/`automated`/`automatic` — and D6's
  `createPublicationReceipt` would have thrown had it been, per that
  function's own coverage.

## What this section did not duplicate

HTTP-layer reachability for an authenticated actor of each role was
already proven for real in section 8 (running `next start`, real
`fetch()`, real `Cookie` header) — this section does not spin up a second
server run for the same purpose. What section 8 did *not* cover — the
actual backend chain composing correctly for a client onboarded through a
real invitation, not a directly-created membership — is exactly what this
section adds.

## Verification

`npm run typecheck` PASS, `npm test` PASS (221/221, 22 files, up from 219
after section 7/8's additions), `node scripts/security-scan.mjs` clean.
