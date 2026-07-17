# RECOVERED_VS_RECONSTRUCTED

Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC (this report itself).
Purpose: make it impossible to mistake reconstructed code for recovered
code anywhere in this repository, per `AGENTS.md` rule 3 and
`docs/rebuild/REBUILD_MASTER_PLAN.md` §3's class A/B/C boundary.

## Class A — VERIFIED_RECOVERED_SOURCE

None in this repository. No file with fully-confirmed content *and* a
confirmed original path was recovered from `E:\GEO_RECOVERY_SAFE`.

## Class B — PARTIAL_RECOVERED_SOURCE

Exactly 7 files, all under `recovered/partial-source/` on `main`, imported
in the baseline commit and untouched since:

- `000400000009FE5D3E3C4D93-shared.tsx` (FoundationPage shell)
- `00040000000C9C455B787075-route.ts` (invitation DELETE handler — real
  corroborating evidence for B4's `revokeInvitation` and B5's
  `revokeAndRecordInvitation`)
- `00040000000C9C5B63B4983F-page.tsx` (NewAgencyPage)
- `00040000000C9C5E6C12D671-page.tsx` (NewClientPage)
- `00040000000C9C607C9A7F12-page.tsx` (AssignmentsPage — real corroborating
  evidence for C3's active-assignment filtering)
- `00040000000C9C6422CCAB4F-page.tsx` (AuditPage — real corroborating
  evidence for B4/B5's audit fields and C4's truncated-actor-id pattern)
- `00040000000C9C661E8C211C-page.tsx` (AgencyNewClientPage)

Content is verified byte-for-byte against the read-only recovery source
(sha256-recorded in `docs/rebuild/RECOVERY_FILE_INVENTORY.json`); original
file paths are lost, so these live in a quarantine directory rather than
being wired into `src/app/*` as if their location were known.

## Class C — RECONSTRUCTED_FROM_FROZEN_SPEC

Everything else written this session — every file under
`src/contracts/tenancy/`, `src/contracts/geo-business/`, `migrations/`,
`src/app/`, `src/components/`, `src/lib/workspace-nav.ts`, and every test
file. All carry the `RECONSTRUCTED_FROM_FROZEN_SPEC` provenance header with
`reconstruction_source` / `reconstruction_reason` / `original_file_unavailable`.

### Evidence-corroborated reconstructions (higher confidence)

Reconstructed code that a Class B file or the recovery matrix independently
confirms is *shaped* correctly, even though the code itself wasn't recovered:

- `src/contracts/tenancy/entities.ts` — `Organization`/`Membership`/
  `Invitation`/`AuthorizationContext` shapes corroborated by the 7 Class B
  files' real usage of `tenancyRepository`, `OrganizationCreateForm`,
  `AssignmentForm`, `requireSurfaceAuthorization("ops")`.
- `src/contracts/tenancy/invitations.ts` `revokeInvitation` — call-shape
  (`{ invitationId, actor, now }`) directly corroborated by the recovered
  DELETE route.
- `src/contracts/geo-business/entities.ts` `ArticleBrief` — name and field
  hints (`ArticleBriefPlanningContextV1`, `BRIEF_PLANNING_CONTEXT_REQUIRED`)
  corroborated by real literal hits in the recovery matrix, unlike most of
  this file's other type names.

### Explicitly own-naming (owner-recalled name had zero recovered hits)

Per `docs/rebuild/RECOVERY_GAP_ANALYSIS.md` and `GEO_BUSINESS_CHAIN_V1.md`'s
naming caution — these concepts are real (the chain description itself is
trusted) but their exact names are this rebuild's invention, not recovered
fact: `OpportunityFamily` (not `ArticleFamily`), `GeoValidationGateLevel`/
`PlatformGate`/`VerticalGate` (not `PLATFORM_RULE_GATE`/`VERTICAL_RULE_GATE`),
`HumanReviewDecisionStatus` (not `NEEDS_HUMAN_REVIEW`), `Opportunity`/
`OpportunityValidationStatus` (not `ArticleOpportunity`/
`KNOWLEDGE_GROUNDED_OPPORTUNITY`/`INDUSTRY_HYPOTHESIS`/`CONFIRMED_DEMAND`),
`ProviderArticleContent`/`ArticleDraft`/`ArticleDraftCompiler` (zero
recovered hits for any of the three). Each is flagged inline in
`src/contracts/geo-business/entities.ts` at its point of definition — this
report does not duplicate every inline comment, it records the boundary.

## What must never happen going forward

No PR may relabel a Class C file as Class A or B, and no PR may claim a new
git commit SHA corresponds to a historical one. `AGENTS.md` rule 1 and rule
3 remain the binding constraint; this report exists so that check is
mechanical (grep the provenance headers) rather than a matter of memory.
