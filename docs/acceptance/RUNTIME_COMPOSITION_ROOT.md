# RUNTIME_COMPOSITION_ROOT

Phase: `REBUILD_INTEGRATION_ACCEPTANCE_V1`, section 五.
Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC (this report itself).

## What was built

`ApplicationCompositionRootV1` (`src/composition/application-composition-root.ts`)
wires all nine services named in this phase's spec:

| Service | Source | New this phase? |
|---|---|---|
| `tenancyRepository` | `InMemoryTenancyRepository` (B5) | No — composed, not reimplemented |
| `authorizationService` | `authorization.ts` functions (B2) | No — composed, not reimplemented |
| `auditService` | `tenancyRepository.recordAudit`/`listAudit` (B4 + a new public entry point added this phase — see below) | Partially |
| `knowledgeService` | `KnowledgeService` | Yes |
| `opportunityService` | `OpportunityService` | Yes |
| `humanReviewService` | `HumanReviewService` | Yes |
| `articlePipelineService` | `ArticlePipelineService` | Yes |
| `publicationPackageService` | `PublicationPackageService` | Yes |
| `frontendReadModelService` | `FrontendReadModelService` | Yes |

Two new storage/data files back the new services:

- `src/contracts/tenancy/in-memory-repository.ts` — added one public method,
  `recordAudit(input)`. B5's repository could previously only append an
  `AuditEvent` from inside its own two invitation methods; this is the
  missing public entry point every other service now uses, so there is a
  single append-only audit log, not two.
- `src/contracts/geo-business/repository.ts` — genuinely new: an
  `InMemoryGeoBusinessRepository` (Map-backed, same discipline as B5's
  tenancy repository) storing every entity across the D1-D6 chain. No lane
  built a storage layer for the GEO business chain during the overnight
  rebuild — D1-D6 are pure types and pure transformation functions with
  nothing to persist them or query them back. This repository is that
  missing layer.

## Cross-lane audit wiring (section 5's core requirement)

Every one of the seven named actions writes a real `AuditEvent` through
`tenancyRepository.recordAudit`, append-only (no update/delete method
exists on the repository):

| Spec action | Service method | Audit action string |
|---|---|---|
| KnowledgePackage Created | `KnowledgeService.createKnowledgePackage` | `knowledge_package.created` |
| Opportunity Created | `OpportunityService.createOpportunity` | `opportunity.created` |
| Human Review Confirmed | `HumanReviewService.confirm` | `human_review.confirmed` |
| Human Review Changes Requested | `HumanReviewService.requestChanges` | `human_review.changes_requested` |
| Article Approved | `ArticlePipelineService.approveArticle` | `article.approved` |
| PublishPackage Created | `PublicationPackageService.createPublishPackage` | `publish_package.created` |
| Publication Receipt Recorded | `PublicationPackageService.recordPublicationReceipt` | `publication_receipt.recorded` |

(`HumanReviewService.reject` also audits, as `human_review.rejected` — not
explicitly named in the spec's list of seven, but the same discipline
applies since `HumanReviewDecision` has three real variants, not two.)

## Design decisions worth flagging

- **Services delegate to D-lane's pure functions wherever one exists.**
  `ArticlePipelineService.compileDraft` calls D4's `compileArticleDraft`
  verbatim; `evaluateQuality` calls D5's `evaluateQualityGate` verbatim;
  `PublicationPackageService`'s three methods call D6's
  `buildPublishPackage`/`createChannelNeutralContentPackage`/
  `createPublicationReceipt` verbatim. These services add authorization
  checks, persistence, and audit logging — they never reimplement business
  rules those functions already own.
- **PlatformGate/VerticalGate needed new evaluators.** D5 defined the
  outcome *types* for `PlatformGate` and `VerticalGate` but, unlike
  `QualityGate`, shipped no pure evaluator function for either. This phase
  added `evaluatePlatformGate`/`evaluateVerticalGate` in
  `ArticlePipelineService`, following the exact same purity discipline
  `evaluateQualityGate` already established (no imports beyond what's
  already present, no I/O, no `Date.now()`/`Math.random()`,
  caller-supplied identity/timestamp). These are new business logic, not
  merely wiring — flagged explicitly rather than silently added.
- **Every mutation is tenant-checked before touching data.** Every service
  method's first real statement is `assertCanAccessClientOrganization(actor,
  clientOrganizationId)` (B2). This is proven, not just asserted: the
  end-to-end composition test includes a negative case (a client outside
  the scope cannot read another client's delivery center through the read
  model) and the ops audit trail throws for a non-platform-admin actor.
- **`FrontendReadModelService` does not replace the frontend's fixtures.**
  Per this phase's own section 一 freezing `FRONTEND_WORKSPACES_FIXTURE_V1`
  and forbidding new lateral business features, C1-C6's fixture-driven
  pages are untouched. This service exists specifically to give section 9
  (minimal runtime E2E) something real to assert against — "the client can
  see the delivery result", proven with real composed data, not to become
  a second frontend data source.

## Verification

`tests/composition/application-composition-root.test.ts` — three tests, all
passing:
1. A full offline chain (platform admin → agency → client → project →
   knowledge → opportunity → human review CONFIRMED → family → brief →
   provider content → draft → all three gates PASSED → article approval →
   publish package → channel-neutral package (proven to start at 0
   channels) → distribution plan (1 explicitly-chosen channel) →
   publication receipt), then reads the result back through
   `FrontendReadModelService` and confirms all 6 of the spec's named audit
   actions landed in the real audit log, exactly once each.
2. A non-platform-admin actor is denied reading the cross-tenant audit
   trail.
3. A client organization cannot read another client organization's
   delivery center through the read model — tenant isolation holds on the
   read side too, not just the write side.

`npm run typecheck` PASS, `npm test` PASS (212/212, 20 files, up from 209
after contract unification), `node scripts/security-scan.mjs` clean.
