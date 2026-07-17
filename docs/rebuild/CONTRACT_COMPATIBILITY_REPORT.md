# CONTRACT_COMPATIBILITY_REPORT

Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC (this report itself).
Purpose: B, D, and C were built on independent branches with no cross-branch
imports (a deliberate constraint — see `AGENTS.md`, "different worktrees").
Several checkpoints therefore built *local* mirrors of concepts owned by
another lane. This report checks those mirrors actually match, so
integration doesn't silently paper over a drift once cross-imports become
possible.

## Checked pairs

### 1. `ClientReviewDecision.decision` (B1-CORRECTION) vs `ClientConfirmationDecision` (C5)

- B side (`src/contracts/tenancy/entities.ts`): `"CONFIRMED" | "CHANGES_REQUESTED" | "DEFERRED"`.
- C side (`src/app/app/_confirmation.ts`): `"CONFIRMED" | "CHANGES_REQUESTED" | "DEFERRED"`, plus a UI-only `NOT_YET_REVIEWED` sentinel with no B-side equivalent.
- **Result: MATCH.** Three real values agree exactly, including the specific B1-CORRECTION decision to drop `REJECTED` in favor of `CHANGES_REQUESTED`. C5's extra `NOT_YET_REVIEWED` state is presentation-layer only (an unreviewed item has no `ClientReviewDecision` row at all on the B side, which is the same "no row = not decided" semantics, just made explicit as a fourth UI state) — not a drift, a compatible extension.

### 2. `PlatformRole` (B1) vs C3's local `AgencyTeamRole`

- B side: `"PLATFORM_SUPER_ADMIN" | "AGENCY_OWNER" | "AGENCY_OPERATOR" | "CLIENT_OWNER"`.
- C3 side (`src/app/agency/team/page.tsx` or its fixtures): a local type restricted to the two agency-relevant roles, `AGENCY_OWNER`/`AGENCY_OPERATOR`.
- **Result: MATCH (subset).** C3's local type is a deliberate, documented subset of B's full role enum, scoped to what an agency-workspace team page needs to display. No conflicting third value invented.

### 3. `GeoValidationGateLevel` (D1) vs any frontend/tenancy gate concept

- No C or B lane defines a competing gate-level concept. **No conflict — not applicable.**

### 4. Tenant-scoping field names across B and D

- B (`migrations/0001_tenancy_foundation.sql`, `entities.ts`): `clientOrganizationId` / `projectId` used consistently across `Project`, `ClientReviewDecision`, `AuditEvent`, `ArtifactIndex`.
- D (`src/contracts/geo-business/entities.ts`): every chain entity (`KnowledgePackage` through `ArticleApproval`) uses the identical field names `clientOrganizationId` / `projectId`.
- **Result: MATCH.** When these two lanes eventually integrate, the geo-business chain's tenant-scoping fields line up with the tenancy lane's field names with no renaming required.

### 5. `AuditEvent` shape (B1/B3/B4/B5) vs D's audit expectations

- D's chain does not currently reference `AuditEvent` directly (no checkpoint through D5 wires D-lane actions into B's audit log — this is expected, since the lanes don't cross-import yet).
- **Result: not yet integrated, no conflict to report.** Flagged as a real integration task for whichever future checkpoint wires D-lane actions (e.g. `ArticleApproval` decisions) into B's `recordAuditEvent`.

## Naming collisions checked and found clear

- No two lanes independently invented a type or constant with the *same name* but a *different shape* (the failure mode this report exists to catch). The closest cases (pair 1 and pair 2 above) were deliberate, compatible mirrors, not accidental collisions.

## Recommendation for the eventual full integration (not yet done)

When B, D, and C are eventually merged into one buildable tree (post P0
scaffold unification — currently each lane's own worktree runs its own
`npm test`, they are not yet compiled together as one program beyond what
`integration/rebuild-nightly`'s merges already prove typechecks together),
re-run this comparison against the literal merged `entities.ts` files
rather than against each lane's separate copy, since `integration/rebuild-nightly`
merges the *files*, not their concepts — a future edit to B's
`ClientReviewDecision` would not automatically propagate to C5's mirror.
