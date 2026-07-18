# CANONICAL_CONTRACT_UNIFICATION

Phase: `REBUILD_INTEGRATION_ACCEPTANCE_V1`, section 四.
Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC (this report itself).

## Why this was needed

During the overnight rebuild, lanes B (`rebuild/tenancy-auth`), C
(`rebuild/frontend-workspaces`), and D (`rebuild/geo-business-pipeline`)
worked on independent branches with a deliberate constraint: no
cross-branch imports (see `AGENTS.md`, "Agents B, C, D"). Where the
frontend lane needed a concept another lane owned, it redeclared an
equivalent shape locally, with a comment documenting the intent to unify
once the branches merged. `integration/rebuild-nightly` then merged the
*files* from all three lanes into one tree — but merging files does not
automatically collapse independently-declared types that happen to share
a shape. This document is the audit of every place that had actually
happened, and what was done about each one.

## Duplicates found and fixed

| Local (duplicate) declaration | File | Canonical source | Fix |
|---|---|---|---|
| `ClientConfirmationDecision` | `src/app/app/_confirmation.ts` | `ClientReviewDecisionValue` — `src/contracts/tenancy/entities.ts` (via `review.ts`) | Now a type alias of the canonical type, not an independent redeclaration. `NOT_YET_REVIEWED` kept as a genuine UI-only presentation sentinel (no business-layer equivalent — an unreviewed item has no `ClientReviewDecision` row), with explicit `toReviewDecision`/`fromReviewDecision` conversion functions rather than an implicit cast. |
| `AgencyTeamRole` | `src/app/agency/_fixtures.ts` | `PlatformRole` — `src/contracts/tenancy/entities.ts` | Now `Extract<PlatformRole, "AGENCY_OWNER" \| "AGENCY_OPERATOR">` — a real, compiler-checked subset of the canonical union, not an independently-spelled-out literal union that could silently drift. |
| `AgencyClientAssignmentStatus` | `src/app/agency/_fixtures.ts` | `AgencyClientAssignmentStatus` — `src/contracts/tenancy/entities.ts` (previously inline on the `AgencyClientAssignment.status` field, extracted to a named export as part of this fix) | Imported directly; local declaration removed. |
| `PlatformAssignmentStatus` | `src/app/ops/_fixtures.ts` | `AgencyClientAssignmentStatus` — `src/contracts/tenancy/entities.ts` | Now a type alias of the canonical type. |
| `InvitationStatus` | `src/app/ops/_fixtures.ts` | `InvitationStatus` — `src/contracts/tenancy/entities.ts` | Exact duplicate (identical value set). Imported under a local alias (`CanonicalInvitationStatus`) to avoid a name collision with the many existing call sites using the local name `InvitationStatus`, then re-exported as `export type InvitationStatus = CanonicalInvitationStatus`. |
| `OrganizationType` | `src/app/ops/_fixtures.ts` | `OrganizationType` — `src/contracts/tenancy/entities.ts` | Exact duplicate, verbatim. Not previously flagged in any prior checkpoint's own review — found during this acceptance pass. Local declaration removed, canonical type imported directly. |

Six duplicates found, all in the frontend lane (expected — B and D never
had a reason to redeclare each other's types, and didn't; only C had a
structural need to work around the no-cross-branch-import constraint).

## What was NOT merged into one type, and why

- `HumanReviewDecisionStatus` (D lane: `APPROVED` / `CHANGES_REQUESTED` /
  `REJECTED`) and `ClientReviewDecisionValue` (B lane: `CONFIRMED` /
  `CHANGES_REQUESTED` / `DEFERRED`) share the `CHANGES_REQUESTED` value and
  a similar shape, but are genuinely different domain concepts — one is a
  human editor's approval decision on an `Opportunity`, the other is a
  client's review of a keyword/content-direction/source-type. Forcing them
  into one shared type would either lose `REJECTED` (a real terminal state
  the client-review workflow deliberately doesn't have, per B1-CORRECTION)
  or add `DEFERRED` to a workflow that never asked for it. Instead,
  `ContentApprovalStatus` was added as an explicit *alias* of
  `HumanReviewDecisionStatus` in `src/contracts/geo-business/entities.ts`
  — the single canonical name this phase's spec asked for, pointing at the
  real existing type rather than inventing a second one.

## New canonical types introduced this phase

- `AgencyClientAssignmentStatus` — extracted from an inline field type to
  a named export in `src/contracts/tenancy/entities.ts` (see table above).
- `ContentApprovalStatus` — alias of `HumanReviewDecisionStatus`, added to
  `src/contracts/geo-business/entities.ts`.
- `PublicationStatus` — genuinely new: no lane had previously needed a
  cross-cutting summary of "where is this PublishPackage in its journey to
  being published" (`PACKAGED` / `CHANNELS_SELECTED` /
  `PARTIALLY_PUBLISHED` / `PUBLISHED`). Added to
  `src/contracts/geo-business/entities.ts` along with a pure
  `derivePublicationStatus(plan, receipts)` function — deliberately
  *derived*, never a separately-stored field, so it cannot drift from the
  real `DistributionPlan`/`PublicationReceipt` records the way a cached
  status column could.
- `ClientOrganizationId` / `ProjectId` — added to `src/contracts/index.ts`
  as canonical **type aliases** (`= string`), not branded/nominal types.
  A real nominal-typing sweep (`string & { readonly __brand: ... }`) would
  require casting every fixture literal across roughly a dozen files — a
  much larger, separately-scoped change than this phase's mandate to
  eliminate *duplicate contract definitions*. This is a documented,
  deliberate scope boundary, not an oversight.

## New files

- `src/contracts/index.ts` — the canonical root, exporting `tenancy`,
  `review`, `geoBusiness`, and `publication` namespaces.
- `src/contracts/tenancy/review.ts` — curated re-export of the
  review-decision surface from `tenancy/entities.ts`.
- `src/contracts/geo-business/publication.ts` — curated re-export of the
  distribution/publication-layer surface from `geo-business/entities.ts`.

Both curated re-export files exist because physically splitting either
1,400+/200-line `entities.ts` file into smaller modules would be a much
larger, riskier refactor than this phase's time budget justifies — the
re-export files give the requested focused namespaces without moving any
type's actual definition.

## Contract-drift test

`tests/contracts/contract-drift.test.ts`, two independent checks:

1. A static source scan across every file under `src/app/` for a literal
   union type declaration whose value set matches one of the known
   canonical signatures — this is what a *reintroduced* duplicate would
   look like. Verified to actually fail (not vacuous) by temporarily
   reintroducing a duplicate `OrganizationType`-shaped declaration during
   this phase and confirming the test caught it before removing the
   temporary code.
2. Compile-time type-equality assertions (checked via `tsc --noEmit`
   against this test file) proving the remaining UI-local aliases really
   do resolve to the canonical type, not merely a same-shaped duplicate.
