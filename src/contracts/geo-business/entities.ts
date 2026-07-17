/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * reconstruction_source: docs/architecture/GEO_BUSINESS_CHAIN_V1.md
 * reconstruction_reason: no original source recoverable for this chain
 * original_file_unavailable: true
 *
 * Checkpoint D1 — first three entities in the GEO business chain per
 * docs/architecture/GEO_BUSINESS_CHAIN_V1.md ("Chain (P2 priority)",
 * items 1-2):
 *
 *   1. KnowledgePackage   — an ingested slice of a client's enterprise
 *                            knowledge base.
 *   2. IndustryProfile    — the vertical/industry classification context
 *                            a client's knowledge and keywords are
 *                            validated against.
 *   3. KeywordQuestionMap — the keyword <-> real user-question mapping
 *                            sourced from a KnowledgePackage.
 *
 * NAMING CAUTION (see GEO_BUSINESS_CHAIN_V1.md, "Explicit caution for
 * reconstruction", and docs/rebuild/RECOVERY_GAP_ANALYSIS.md): the
 * project owner's recalled PascalCase type names for this chain
 * (ChannelNeutralContentPackageV1, KnowledgeDocument/KnowledgeVersion/
 * KnowledgeChunk/KnowledgeSnapshot/KnowledgeIssue,
 * ArticleExecutionContext, ArticleOpportunity, ArticleFamily,
 * PLATFORM_RULE_GATE, VERTICAL_RULE_GATE, NEEDS_HUMAN_REVIEW,
 * KNOWLEDGE_GROUNDED_OPPORTUNITY, INDUSTRY_HYPOTHESIS, CONFIRMED_DEMAND)
 * had ZERO literal hits in recovered evidence. None of those identifiers
 * are used below. Where this file introduces a concept that rhymes with
 * one of those (e.g. a governance "gate" level on IndustryProfile), the
 * identifier is deliberately named differently and flagged inline as an
 * own-naming assumption, not a recovered fact.
 *
 * Tenant isolation (docs/governance/SYSTEM_INVARIANTS_V1.md,
 * "Tenant isolation"): this business chain is not exempt from tenancy
 * rules, so every entity below is explicitly scoped to a
 * `clientOrganizationId` and `projectId` rather than assuming a
 * single-tenant world.
 */

/**
 * A KnowledgePackage represents one ingested slice of a client's
 * enterprise knowledge base, scoped to the client organization and
 * project it was ingested for.
 *
 * Versioning: `version` is a monotonically increasing integer per
 * (clientOrganizationId, projectId). A package is mutable while in
 * `"DRAFT"` status; once transitioned to `"SEALED"` it is treated as an
 * immutable historical artifact (per SYSTEM_INVARIANTS_V1's
 * recovery/reconstruction and determinism expectations for this chain) —
 * the discriminated union below encodes that a `sealedAt` timestamp only
 * exists on the sealed variant, and downstream code should never mutate a
 * sealed package in place.
 */
interface KnowledgePackageBase {
  id: string;
  clientOrganizationId: string;
  projectId: string;
  /** Monotonically increasing per (clientOrganizationId, projectId). */
  version: number;
  title: string;
  /** Human-readable description of where this slice of knowledge came from. */
  sourceDescription: string;
  createdAt: string;
}

export interface DraftKnowledgePackage extends KnowledgePackageBase {
  status: "DRAFT";
}

export interface SealedKnowledgePackage extends KnowledgePackageBase {
  status: "SEALED";
  /** Set once, at seal time. The package must be treated as immutable from this point on. */
  sealedAt: string;
}

export type KnowledgePackage = DraftKnowledgePackage | SealedKnowledgePackage;

/**
 * The governance "gate" level a client's knowledge/keywords are validated
 * against for a given industry vertical.
 *
 * OWN-NAMING ASSUMPTION: GEO_BUSINESS_CHAIN_V1.md's evidence-corroboration
 * section notes the owner recalled PLATFORM_RULE_GATE / VERTICAL_RULE_GATE
 * identifiers, but those had zero literal hits in recovered evidence. The
 * two members below are a reconstruction of the same *concept* (a
 * platform-wide gate vs. a narrower vertical-specific gate), deliberately
 * spelled differently so this is never mistaken for a recovered constant.
 */
export type GeoValidationGateLevel = "PLATFORM_WIDE_GATE" | "INDUSTRY_VERTICAL_GATE";

/**
 * An IndustryProfile is the vertical/industry classification context that
 * a client's KnowledgePackage content and KeywordQuestionMap entries are
 * validated against. Scoped per client organization and project, since a
 * single agency may run clients across different verticals.
 */
export interface IndustryProfile {
  id: string;
  clientOrganizationId: string;
  projectId: string;
  /** Short machine-facing slug, e.g. "healthcare", "b2b-saas". Own reconstructed taxonomy, not a recovered enum. */
  verticalSlug: string;
  /** Human-readable label, e.g. "Healthcare & Life Sciences". */
  verticalLabel: string;
  validationGateLevel: GeoValidationGateLevel;
  /** Version of the rule set this profile was classified under, for auditability. */
  ruleSetVersion: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * One keyword and the real user questions it maps to. `questions` must be
 * non-empty — the whole point of this structure (per GEO_BUSINESS_CHAIN_V1
 * item 2, "Keyword / user-question map") is pairing a keyword with the
 * actual questions real users ask around it, not just a bare keyword list.
 */
export interface KeywordQuestionEntry {
  keyword: string;
  questions: string[];
}

/**
 * KeywordQuestionMap is the keyword <-> real user-question mapping this
 * business chain is built around. It is always sourced from a specific
 * KnowledgePackage (pinned by id *and* version, so the mapping's
 * provenance survives the source package later being sealed or
 * superseded by a newer version) and validated against an
 * IndustryProfile.
 */
export interface KeywordQuestionMap {
  id: string;
  clientOrganizationId: string;
  projectId: string;
  /** The KnowledgePackage this map was derived from. */
  knowledgePackageId: string;
  /** Pins to the specific KnowledgePackage.version used at derivation time. */
  knowledgePackageVersion: number;
  /** The IndustryProfile this map's entries were validated against. */
  industryProfileId: string;
  entries: KeywordQuestionEntry[];
  createdAt: string;
}

/**
 * Checkpoint D2 — next two chain steps per
 * docs/architecture/GEO_BUSINESS_CHAIN_V1.md ("Chain (P2 priority)",
 * items 3-4):
 *
 *   4. Opportunity           — a candidate content opportunity derived
 *                               from a KeywordQuestionMap entry.
 *   5. OpportunityValidation — the outcome of validating an Opportunity
 *                               against an IndustryProfile.
 *   6. HumanReviewDecision   — the human-review gate outcome for an
 *                               Opportunity.
 *
 * NAMING CAUTION (see GEO_BUSINESS_CHAIN_V1.md, "Explicit caution for
 * reconstruction"): the owner-recalled identifiers `ArticleOpportunity`,
 * `ArticleFamily`, `KNOWLEDGE_GROUNDED_OPPORTUNITY`, `INDUSTRY_HYPOTHESIS`,
 * `CONFIRMED_DEMAND`, and `NEEDS_HUMAN_REVIEW` had ZERO literal hits in
 * recovered evidence. None of those identifiers are reused verbatim below.
 * `Opportunity`, `OpportunityValidation`, `HumanReviewDecision`, and every
 * member of `OpportunityValidationStatus` / `HumanReviewDecisionStatus`
 * are this checkpoint's own reconstructed naming, chosen to match the
 * chain description ("Opportunity validation" / "Human review (gate)")
 * rather than any recovered literal — flagged here as an own-naming
 * assumption, not a recovered fact.
 */

/**
 * A candidate content opportunity derived from one KeywordQuestionMap
 * entry. Scoped to (clientOrganizationId, projectId) per the tenant
 * isolation invariant, and — per this chain's evidence-corroboration
 * notes on knowledge-grounded content — required (not optional) to trace
 * back to the specific KnowledgePackage id+version it was grounded in, via
 * the sourcing KeywordQuestionMap. Grounding is deliberately non-optional:
 * there is no valid Opportunity that lacks a knowledge source.
 */
export interface Opportunity {
  id: string;
  clientOrganizationId: string;
  projectId: string;
  /** The KeywordQuestionMap entry this opportunity was derived from. */
  keywordQuestionMapId: string;
  /** The specific keyword within that map's entries this opportunity targets. */
  keyword: string;
  /**
   * The KnowledgePackage this opportunity is grounded in. Required, not
   * optional: content without a traceable knowledge source is not a valid
   * Opportunity in this system (see GEO_BUSINESS_CHAIN_V1.md evidence
   * corroboration on knowledge-grounded content).
   */
  groundingKnowledgePackageId: string;
  /** Pins to the specific KnowledgePackage.version this opportunity was grounded in. */
  groundingKnowledgePackageVersion: number;
  createdAt: string;
}

/**
 * OWN-NAMING ASSUMPTION: reconstructed status vocabulary for "Opportunity
 * validation" (chain item 3), not a recovered enum. Deliberately spelled
 * to avoid the recovered-but-unconfirmed `KNOWLEDGE_GROUNDED_OPPORTUNITY`
 * / `INDUSTRY_HYPOTHESIS` / `CONFIRMED_DEMAND` identifiers noted in
 * GEO_BUSINESS_CHAIN_V1.md as having zero literal hits in evidence.
 */
export type OpportunityValidationStatus =
  | "PENDING_VALIDATION"
  | "VALIDATED"
  | "REJECTED";

/**
 * The outcome of validating an Opportunity against an IndustryProfile.
 * Scoped per tenant, referencing both the Opportunity being validated and
 * the specific IndustryProfile (and its gate level, carried alongside the
 * reference for auditability in case the profile's gate level changes
 * after this validation was recorded) used to validate it.
 */
export interface OpportunityValidation {
  id: string;
  clientOrganizationId: string;
  projectId: string;
  opportunityId: string;
  status: OpportunityValidationStatus;
  /** The IndustryProfile this Opportunity was validated against. */
  industryProfileId: string;
  /**
   * The gate level in effect on the IndustryProfile at validation time,
   * captured alongside the reference for auditability (the profile's own
   * gate level may change later; this field is a point-in-time record of
   * what was actually applied).
   */
  gateLevelApplied: GeoValidationGateLevel;
  /** Free-text rationale for the status, e.g. why an opportunity was rejected. */
  reasonNote: string;
  validatedAt: string;
}

/**
 * Per docs/governance/SYSTEM_INVARIANTS_V1.md, human review is not
 * default-approved. This is modeled as a discriminated union, in the same
 * spirit as the tenancy lane's ClientReviewDecision
 * (CONFIRMED/CHANGES_REQUESTED/DEFERRED rather than a boolean): there is
 * no "approved: boolean = true" default, and no variant of this union can
 * represent an approval without an explicit, non-optional reviewer
 * identity and decision timestamp. An Opportunity that has not yet been
 * reviewed simply has no HumanReviewDecision object at all — it is never
 * represented by a HumanReviewDecision in an "approved" shape with a
 * missing/placeholder reviewer.
 *
 * OWN-NAMING ASSUMPTION: `HumanReviewDecisionStatus` and its members are
 * this checkpoint's own reconstructed naming for chain item 4 ("Human
 * review (gate)"); GEO_BUSINESS_CHAIN_V1.md notes the owner-recalled
 * `NEEDS_HUMAN_REVIEW` identifier had zero literal hits in recovered
 * evidence, so it is not reused here.
 */
export type HumanReviewDecisionStatus = "APPROVED" | "CHANGES_REQUESTED" | "REJECTED";

interface HumanReviewDecisionBase {
  id: string;
  clientOrganizationId: string;
  projectId: string;
  opportunityId: string;
  /** The OpportunityValidation outcome this human review is acting on. */
  opportunityValidationId: string;
  status: HumanReviewDecisionStatus;
  /** Required, non-optional: no decision may exist without a real reviewer identity. */
  reviewerId: string;
  /** Required, non-optional: no decision may exist without a decision timestamp. */
  decidedAt: string;
}

export interface ApprovedHumanReviewDecision extends HumanReviewDecisionBase {
  status: "APPROVED";
}

export interface ChangesRequestedHumanReviewDecision extends HumanReviewDecisionBase {
  status: "CHANGES_REQUESTED";
  /** Required for this variant: reviewers must state what needs to change. */
  requestedChangesNote: string;
}

export interface RejectedHumanReviewDecision extends HumanReviewDecisionBase {
  status: "REJECTED";
  /** Required for this variant: reviewers must state why the opportunity was rejected. */
  rejectionReasonNote: string;
}

/**
 * A HumanReviewDecision is always one of these three variants, and every
 * variant requires `reviewerId` + `decidedAt`. There is no fourth,
 * "unreviewed-but-approved" variant, and no field default can produce an
 * approved decision without a reviewer — see the type-level test in
 * tests/contracts/geo-business-entities.test.ts that demonstrates this
 * directly (object literals missing `reviewerId` fail to type-check).
 */
export type HumanReviewDecision =
  | ApprovedHumanReviewDecision
  | ChangesRequestedHumanReviewDecision
  | RejectedHumanReviewDecision;

/**
 * Checkpoint D3 — next two chain steps per
 * docs/architecture/GEO_BUSINESS_CHAIN_V1.md ("Chain (P2 priority)",
 * items 5-6):
 *
 *   7. OpportunityFamily — groups one or more APPROVED Opportunities into
 *                           the unit that becomes a single piece of
 *                           content.
 *   8. ArticleBrief       — the planning brief built from an
 *                           OpportunityFamily.
 *
 * NAMING CAUTION (see GEO_BUSINESS_CHAIN_V1.md, "Explicit caution for
 * reconstruction", and docs/rebuild/recovered-evidence/
 * TARGET_STATE_MANIFEST.md section 2): the owner-recalled identifier
 * `ArticleFamily` (bare) had ZERO literal hits in recovered evidence —
 * same standing as `ArticleExecutionContext` / `ArticleOpportunity` / the
 * other zero-hit names flagged in the D1/D2 captions above. The type
 * below is therefore deliberately named `OpportunityFamily`, not
 * `ArticleFamily`: it groups `Opportunity` records (this checkpoint's own
 * reconstructed chain-item-4 name from D2), and the rename makes explicit
 * that this is an own-naming assumption, not a recovered fact.
 *
 * `ArticleBrief` is different: it is a WELL-EVIDENCED name, not an
 * own-naming assumption. TARGET_STATE_MANIFEST.md section 2 records 4 real
 * literal hits — `ArticleBriefCandidateV1Schema`,
 * `ArticleBriefPlanningContextV1`, `BRIEF_PLANNING_CONTEXT_REQUIRED`, and
 * the real recovered function `buildArticleBriefOfflineV1()` at
 * `src/opportunity/article-brief-offline-v1.ts` (that file is not itself
 * present in this worktree — only its existence, path, and the shape of
 * its recovered test story were recovered, per
 * docs/rebuild/recovered-evidence/TODAY_NODE_RECOVERY_MATRIX.md section 1).
 * `ArticleBrief` is therefore used verbatim as the exported type name
 * below. What was NOT recovered is the field-by-field shape inside
 * `ArticleBriefPlanningContextV1`, or the "Candidate"/"Schema" runtime
 * validation machinery implied by `ArticleBriefCandidateV1Schema` — this
 * checkpoint reconstructs the *field shape* (own-naming assumption at the
 * field level only) and deliberately does not add a runtime schema
 * validator: no such dependency exists in this project yet, and this
 * checkpoint is type-level contracts only, no execution logic.
 */

/**
 * One Opportunity's membership in an OpportunityFamily. Carries not just
 * the authorizing HumanReviewDecision's id but its status, typed as the
 * literal `"APPROVED"` rather than the full `HumanReviewDecisionStatus`
 * union. This is what makes "no Opportunity may enter a family without an
 * APPROVED HumanReviewDecision" a structural rule rather than a
 * runtime-only check: an object literal referencing a
 * `CHANGES_REQUESTED`/`REJECTED` decision's status fails to type-check
 * (see the `@ts-expect-error` case in
 * tests/contracts/geo-business-entities.test.ts) — it does not merely
 * fail an `if` check at runtime.
 */
export interface OpportunityFamilyMember {
  opportunityId: string;
  /** The HumanReviewDecision that authorized this Opportunity's inclusion. */
  authorizingHumanReviewDecisionId: string;
  /**
   * Required, non-optional, and pinned to the literal `"APPROVED"` — see
   * the interface doc comment above for why this is structural, not a
   * runtime-only guard.
   */
  authorizingReviewDecisionStatus: "APPROVED";
}

/**
 * An OpportunityFamily groups one or more APPROVED Opportunities that will
 * become a single piece of content (GEO_BUSINESS_CHAIN_V1.md chain item
 * 5). Tenant-scoped like every entity in this chain. `members` is typed as
 * a non-empty tuple-with-rest (`[OpportunityFamilyMember,
 * ...OpportunityFamilyMember[]]`) rather than a plain array, so an empty
 * family — which would violate "one or more" — cannot be constructed at
 * the type level either.
 */
export interface OpportunityFamily {
  id: string;
  clientOrganizationId: string;
  projectId: string;
  members: [OpportunityFamilyMember, ...OpportunityFamilyMember[]];
  createdAt: string;
}

/**
 * OWN-NAMING ASSUMPTION at the field level (see the file-level comment
 * above): the top-level type name `ArticleBriefPlanningContextV1` is a
 * recovered literal hit, but its internal fields were not recovered.
 * `schemaVersion` follows the versioned-schema string convention
 * corroborated elsewhere in recovered evidence (a real
 * `"schema_version": "PublishPackageReadinessV1"` hit, per
 * GEO_BUSINESS_CHAIN_V1.md). `riskLevel` reflects the recovered test
 * story's "risk escalation" coverage
 * (docs/rebuild/recovered-evidence/TODAY_NODE_RECOVERY_MATRIX.md section
 * 1) without modeling *how* risk is computed — that would be execution
 * logic, out of scope for this checkpoint.
 */
export interface ArticleBriefPlanningContextV1 {
  schemaVersion: "ArticleBriefPlanningContextV1";
  /** The OpportunityFamily this planning context was derived from. */
  opportunityFamilyId: string;
  /**
   * Every authorizing HumanReviewDecision id from the source
   * OpportunityFamily's members, carried forward so the planning context
   * is auditable without re-joining back to the family. Non-empty for the
   * same "one or more" reason as `OpportunityFamily.members`.
   */
  authorizingHumanReviewDecisionIds: [string, ...string[]];
  /** Keywords carried forward from the family's underlying Opportunities. */
  targetKeywords: [string, ...string[]];
  /**
   * Reflects the recovered "risk escalation" test coverage. Own
   * reconstructed vocabulary, not a recovered enum.
   */
  riskLevel: "STANDARD" | "ESCALATED_FOR_HUMAN_REVIEW";
}

/**
 * Recovered evidence includes a real literal hit for a constant named
 * `BRIEF_PLANNING_CONTEXT_REQUIRED` (TARGET_STATE_MANIFEST.md section 2),
 * but not its value, type, or call site. Reconstructed here as a
 * type-level marker documenting (not runtime-enforcing) that
 * `ArticleBrief.planningContext` is required and non-optional — the actual
 * enforcement is the TypeScript field itself being non-optional, proven by
 * the `@ts-expect-error` test that a planningContext-less object literal
 * does not type-check as `ArticleBrief`.
 */
export const BRIEF_PLANNING_CONTEXT_REQUIRED = true as const;

/**
 * ArticleBrief is the planning brief built from an OpportunityFamily
 * (GEO_BUSINESS_CHAIN_V1.md chain item 6), grounded in the real recovered
 * test story for `buildArticleBriefOfflineV1()` (human-review mapping,
 * risk escalation, illegal-family rejection, determinism/immutability —
 * TODAY_NODE_RECOVERY_MATRIX.md section 1). This checkpoint models only
 * the data shape a builder would produce, not the builder itself:
 *
 * - "human-review mapping"     -> `planningContext.authorizingHumanReviewDecisionIds`.
 * - "risk escalation"          -> `planningContext.riskLevel`.
 * - "illegal-family rejection" -> there is no way to construct an
 *   `OpportunityFamily` (and therefore nothing valid for an ArticleBrief
 *   to reference) whose members lack an APPROVED decision — the "illegal
 *   family" case is rejected structurally, upstream of this type, rather
 *   than modeled as a possible ArticleBrief variant here.
 * - "determinism/immutability" -> ArticleBrief has no mutable/draft
 *   fields; every field is required at construction and there is no
 *   partial/patchable variant, mirroring
 *   docs/governance/SYSTEM_INVARIANTS_V1.md's determinism note. A revised
 *   brief is a new ArticleBrief (new id), never a mutation of an existing
 *   one.
 *
 * Per this checkpoint's explicit scope (no execution logic, no field that
 * would require a live provider call to construct), this type carries no
 * provider-response fields, no token/usage counters, and no database
 * write markers — those belong to the (not modeled here) offline build
 * *result* shape `{status, briefs, provider_calls, database_writes,
 * fabricated_defaults}` noted in the recovered test story, which is
 * execution-time output, not this checkpoint's data contract.
 * `workingTitle` and `outline` are this checkpoint's own reconstructed
 * content fields (not claimed as recovered) — plain string/array data with
 * no dependency on a live provider call to construct.
 */
export interface ArticleBrief {
  id: string;
  clientOrganizationId: string;
  projectId: string;
  /** The OpportunityFamily this brief was built from. */
  opportunityFamilyId: string;
  /** Required, non-optional — see BRIEF_PLANNING_CONTEXT_REQUIRED above. */
  planningContext: ArticleBriefPlanningContextV1;
  /** Working title for the resulting piece of content. */
  workingTitle: string;
  /** Section headings/prompts the brief lays out for the eventual article compiler (chain item 7). */
  outline: string[];
  createdAt: string;
}

/**
 * Checkpoint D4 — next chain step per
 * docs/architecture/GEO_BUSINESS_CHAIN_V1.md ("Chain (P2 priority)", item
 * 7): "Article compiler".
 *
 * NAMING CAUTION (see GEO_BUSINESS_CHAIN_V1.md, "Explicit caution for
 * reconstruction"): `ProviderArticleContent`, `ArticleDraft`, and
 * `ArticleDraftCompiler`/`compileArticleDraft` have ZERO literal hits in
 * recovered evidence — the chain description only names the step "Article
 * compiler" generically, with no recovered type/function names attached
 * (unlike `ArticleBrief`, which is a well-evidenced name per the D3
 * caption above). All three identifiers below are this checkpoint's own
 * reconstructed naming, not recovered facts.
 *
 * Opaque-provider-envelope design note: recovered evidence includes a
 * partially-recovered evidence-sealing workflow
 * ("candidate-2-provider-assisted-article-revision-v2") whose directory
 * structure was confirmed but whose actual `raw-provider-envelope.json`
 * content was explicitly NOT recovered (blob decompression failure) — see
 * docs/rebuild/recovered-evidence/TODAY_NODE_RECOVERY_MATRIX.md section 2.
 * Combined with docs/governance/SYSTEM_INVARIANTS_V1.md's "No customer
 * data, no secrets" rule (no raw provider responses may be committed while
 * this repo is public), this is read as a strong signal against treating a
 * raw provider response as a safe, directly-modelable shape. Accordingly,
 * `ProviderArticleContent` below never inlines provider payload content —
 * only an opaque `providerResponseEnvelopeId` pointer to wherever the raw
 * envelope is actually stored, out-of-band from this type.
 *
 * Determinism note (docs/governance/SYSTEM_INVARIANTS_V1.md, "Determinism
 * where the business chain requires it" — the `{status, briefs,
 * provider_calls, database_writes, fabricated_defaults}` recovered test
 * story): `compileArticleDraft` below is a pure data-transformation
 * function. It performs no I/O, calls no provider, and — critically for
 * determinism — never invents its own identity/timestamp values (no
 * `Date.now()`, no `Math.random()`, no uuid generation) since doing so
 * would make "same inputs -> same output" false. `id`/`version`/
 * `compiledAt` are therefore supplied by the caller via the `identity`
 * parameter, exactly like every other entity in this file already has its
 * `id`/`createdAt` assigned externally rather than generated by a
 * constructor.
 */

/**
 * ProviderArticleContent represents content that came back from an AI
 * provider for a given ArticleBrief. Tenant-scoped like every entity in
 * this chain, and references the source ArticleBrief by id. Carries only
 * an opaque pointer to the raw provider response envelope — see the
 * file-level "Opaque-provider-envelope design note" above for why no
 * specific provider response shape is modeled here, and why no payload
 * content field exists on this type at all.
 */
export interface ProviderArticleContent {
  id: string;
  clientOrganizationId: string;
  projectId: string;
  /** The ArticleBrief this content was generated for. */
  articleBriefId: string;
  /**
   * Opaque pointer to wherever the raw provider response envelope is
   * actually stored (e.g. an evidence/object store), out-of-band from this
   * type. Deliberately not a payload field — this type must never carry
   * raw provider response content directly.
   */
  providerResponseEnvelopeId: string;
  receivedAt: string;
}

/**
 * One compiled section of an ArticleDraft, corresponding 1:1 (by position)
 * with an entry in the source ArticleBrief's `outline`. Carries only the
 * heading structure, not provider payload text — consistent with
 * ProviderArticleContent above never exposing raw provider content, this
 * checkpoint's compiler only structures *references*, not extracted
 * provider text (there is no field on ProviderArticleContent to extract
 * such text from in the first place).
 */
export interface ArticleDraftSection {
  /** Carried forward verbatim from ArticleBrief.outline at this position. */
  heading: string;
  /** Position within the outline, 0-based, for stable ordering. */
  order: number;
}

/**
 * The compiled, user-visible draft article. Tenant-scoped, references the
 * ArticleBrief it was compiled from and every ProviderArticleContent it
 * was compiled from (non-empty tuple-with-rest, mirroring
 * OpportunityFamily.members and ArticleBriefPlanningContextV1.targetKeywords
 * elsewhere in this file: a draft compiled from zero provider contents
 * cannot be constructed at the type level either).
 *
 * Versioning follows the same DRAFT/SEALED discriminated-union pattern as
 * KnowledgePackage (see that interface's doc comment above): a draft is
 * mutable while `status: "DRAFT"`; once transitioned to `"SEALED"` it is
 * immutable history, with `sealedAt` only present on the sealed variant.
 * `compileArticleDraft` below only ever produces the DRAFT variant —
 * sealing is a separate, not-yet-modeled step, just as no function in this
 * file seals a KnowledgePackage either.
 */
interface ArticleDraftBase {
  id: string;
  clientOrganizationId: string;
  projectId: string;
  /** The ArticleBrief this draft was compiled from. */
  articleBriefId: string;
  /** Every ProviderArticleContent this draft was compiled from. */
  sourceProviderArticleContentIds: [string, ...string[]];
  /** Monotonically increasing per (clientOrganizationId, projectId, articleBriefId). */
  version: number;
  /** Carried forward from ArticleBrief.workingTitle at compile time. */
  title: string;
  sections: ArticleDraftSection[];
  compiledAt: string;
}

export interface DraftArticleDraft extends ArticleDraftBase {
  status: "DRAFT";
}

export interface SealedArticleDraft extends ArticleDraftBase {
  status: "SEALED";
  /** Set once, at seal time. The draft must be treated as immutable from this point on. */
  sealedAt: string;
}

export type ArticleDraft = DraftArticleDraft | SealedArticleDraft;

/**
 * Caller-supplied identity/versioning/timestamp values for one
 * `compileArticleDraft` call. Deliberately a separate, explicit input
 * rather than something the function invents internally — see the
 * file-level "Determinism note" above.
 */
export interface ArticleDraftCompilationIdentity {
  id: string;
  version: number;
  compiledAt: string;
}

/**
 * ArticleDraftCompiler — the type of the pure compiler function below,
 * named to match GEO_BUSINESS_CHAIN_V1.md chain item 7 ("Article
 * compiler"). Exported as a type alias (rather than only exporting the
 * function) so the compiler's shape can be referenced/asserted against
 * independently of its implementation, e.g. by the determinism tests in
 * tests/contracts/geo-business-compiler.test.ts.
 */
export type ArticleDraftCompiler = typeof compileArticleDraft;

/**
 * Compiles a DraftArticleDraft from an ArticleBrief and the
 * ProviderArticleContent records generated for it. Pure, deterministic
 * data transformation only:
 *
 * - Zero external calls: no provider SDK, no `fetch`/`http`/network import
 *   of any kind anywhere in this module (see the static import-list test
 *   in tests/contracts/geo-business-compiler.test.ts).
 * - Zero I/O: no filesystem, no database access.
 * - Deterministic: given the same `brief`, `providerContents`, and
 *   `identity`, this function returns a deep-equal result every time — it
 *   never reads the clock, never generates randomness, and never mutates
 *   its inputs.
 *
 * Per this checkpoint's explicit scope (no real provider integration
 * exists yet), this performs structural validation and reference
 * assembly only — it does not stub out a fake "call a provider" step, and
 * there is no async/network-shaped code path anywhere in this function.
 *
 * @throws if `brief.planningContext` is missing (defensive runtime check;
 *   TypeScript already makes `planningContext` non-optional at the type
 *   level — see BRIEF_PLANNING_CONTEXT_REQUIRED above — but this guards
 *   the boundary where a `brief` value arrives from outside static typing,
 *   e.g. deserialized JSON).
 * @throws if `providerContents` is empty, or if any entry's
 *   `articleBriefId` does not match `brief.id` (an ArticleDraft may never
 *   be compiled from orphaned/mismatched provider content).
 */
export function compileArticleDraft(
  brief: ArticleBrief,
  providerContents: ProviderArticleContent[],
  identity: ArticleDraftCompilationIdentity,
): DraftArticleDraft {
  if (!brief.planningContext) {
    throw new Error(
      "compileArticleDraft: brief.planningContext is required (see BRIEF_PLANNING_CONTEXT_REQUIRED).",
    );
  }

  if (providerContents.length === 0) {
    throw new Error(
      "compileArticleDraft: at least one ProviderArticleContent is required to compile an ArticleDraft.",
    );
  }

  const mismatched = providerContents.find((content) => content.articleBriefId !== brief.id);
  if (mismatched) {
    throw new Error(
      `compileArticleDraft: ProviderArticleContent "${mismatched.id}" references ArticleBrief ` +
        `"${mismatched.articleBriefId}", not the compiled brief "${brief.id}".`,
    );
  }

  const sourceProviderArticleContentIds = providerContents.map(
    (content) => content.id,
  ) as [string, ...string[]];

  const sections: ArticleDraftSection[] = brief.outline.map((heading, order) => ({
    heading,
    order,
  }));

  return {
    id: identity.id,
    clientOrganizationId: brief.clientOrganizationId,
    projectId: brief.projectId,
    articleBriefId: brief.id,
    sourceProviderArticleContentIds,
    version: identity.version,
    title: brief.workingTitle,
    sections,
    status: "DRAFT",
    compiledAt: identity.compiledAt,
  };
}

/**
 * Checkpoint D5 — next chain step per
 * docs/architecture/GEO_BUSINESS_CHAIN_V1.md ("Chain (P2 priority)", item
 * 8): "Quality gates".
 *
 * NAMING CAUTION (see GEO_BUSINESS_CHAIN_V1.md, "Explicit caution for
 * reconstruction", and the D1 caption above): the owner-recalled
 * `PLATFORM_RULE_GATE` / `VERTICAL_RULE_GATE` identifiers had ZERO literal
 * hits in recovered evidence, and D1 already reconstructed the *gate level*
 * concept as `GeoValidationGateLevel` ("PLATFORM_WIDE_GATE" /
 * "INDUSTRY_VERTICAL_GATE") to avoid reusing those unconfirmed names. This
 * checkpoint introduces a *different* concept — not a gate level on an
 * `IndustryProfile`, but the pass/fail *outcome* of running an
 * `ArticleDraft` through a gate — and deliberately does not reuse
 * `GeoValidationGateLevel` as a type name for it. `PlatformGate` and
 * `VerticalGate` below are this checkpoint's own reconstructed naming for
 * that outcome concept (a "gate result", not a "gate level"); each
 * references `GeoValidationGateLevel` via a `gateLevelApplied` field
 * (reusing D2's `OpportunityValidation.gateLevelApplied` pattern for
 * auditability) rather than duplicating the enum's members. `QualityGate`
 * is a third, distinct outcome type for deterministic content-presence
 * checks that are neither platform-wide nor vertical-specific rules.
 *
 * Non-boolean pass/fail shape: per D2's `HumanReviewDecision` precedent
 * (SYSTEM_INVARIANTS_V1.md, "no silently-approved state"), none of
 * `QualityGate` / `PlatformGate` / `VerticalGate` is a bare
 * `{ passed: boolean }`. Each is a discriminated union on `status:
 * "PASSED" | "FAILED"`, and the `"FAILED"` variant requires a non-empty
 * `failureReasons` tuple — a failure can never be silent/reasonless, and a
 * pass can never be spoofed by an empty-but-truthy shape.
 *
 * `ArticleApproval` gating: per this checkpoint's requirement that
 * publication approval is gated on all three of `QualityGate`,
 * `PlatformGate`, and `VerticalGate` having passed, `ArticleApproval`
 * mirrors D3's `OpportunityFamilyMember` pattern
 * (`authorizingHumanReviewDecisionId` + a status field pinned to the
 * literal `"APPROVED"`) three times over: each gate is referenced by id
 * plus a status field pinned to the literal `"PASSED"` (not the wider
 * `QualityGateStatus`/`GateOutcomeStatus` union). A `FailedQualityGate`'s
 * `status` is statically `"FAILED"`, which is not assignable to a field
 * typed as the literal `"PASSED"` — so an `ArticleApproval` object literal
 * built from a failed (or altogether missing) gate result does not
 * type-check, the same structural guarantee D3 established for family
 * membership. See the `@ts-expect-error` cases in
 * tests/contracts/geo-business-entities.test.ts.
 *
 * Determinism (docs/governance/SYSTEM_INVARIANTS_V1.md): `evaluateQualityGate`
 * below is a pure data-transformation function, following the exact same
 * discipline as D4's `compileArticleDraft` — no imports, no I/O, no
 * `Date.now()`/`Math.random()`/uuid generation inside it. Identity/
 * timestamp values are supplied by the caller via an explicit `identity`
 * parameter, exactly like `ArticleDraftCompilationIdentity` in D4.
 */

/**
 * Shared pass/fail discriminant for the three gate-outcome types below.
 * Deliberately not a bare `boolean` — see the file-level "Non-boolean
 * pass/fail shape" note above.
 */
export type GateOutcomeStatus = "PASSED" | "FAILED";

interface QualityGateBase {
  id: string;
  clientOrganizationId: string;
  projectId: string;
  /** The ArticleDraft this gate evaluated. */
  articleDraftId: string;
  status: GateOutcomeStatus;
  evaluatedAt: string;
}

export interface PassedQualityGate extends QualityGateBase {
  status: "PASSED";
}

export interface FailedQualityGate extends QualityGateBase {
  status: "FAILED";
  /** Required, non-empty: a failed gate must state why, never silently. */
  failureReasons: [string, ...string[]];
}

/**
 * QualityGate is the outcome of running an ArticleDraft through the
 * deterministic quality checks in `evaluateQualityGate` below: minimum
 * content presence (at least one non-empty-heading section), required
 * `ArticleBrief.planningContext` fields present (`targetKeywords`,
 * `authorizingHumanReviewDecisionIds`), and no empty
 * `sourceProviderArticleContentIds` — all facts already established as
 * required by the ArticleDraft/ArticleBrief contracts above (D1-D4); this
 * type does not invent any new field or check beyond re-verifying those at
 * the runtime boundary, the same defensive posture `compileArticleDraft`
 * already takes for `brief.planningContext`.
 */
export type QualityGate = PassedQualityGate | FailedQualityGate;

interface PlatformGateBase {
  id: string;
  clientOrganizationId: string;
  projectId: string;
  /** Discriminant so PlatformGate and VerticalGate are never structurally interchangeable, despite otherwise-identical shapes. */
  gateKind: "PLATFORM_GATE";
  /** The ArticleDraft this gate evaluated. */
  articleDraftId: string;
  /** The IndustryProfile in effect when this gate ran. */
  industryProfileId: string;
  /**
   * The gate level in effect on the IndustryProfile at evaluation time,
   * captured alongside the reference for auditability — same pattern as
   * D2's OpportunityValidation.gateLevelApplied.
   */
  gateLevelApplied: GeoValidationGateLevel;
  status: GateOutcomeStatus;
  evaluatedAt: string;
}

export interface PassedPlatformGate extends PlatformGateBase {
  status: "PASSED";
}

export interface FailedPlatformGate extends PlatformGateBase {
  status: "FAILED";
  /** Required, non-empty: a failed gate must state why, never silently. */
  failureReasons: [string, ...string[]];
}

/**
 * PlatformGate is the outcome of running an ArticleDraft through
 * platform-wide rules (rules that apply regardless of industry vertical).
 * Distinct from VerticalGate below — see the file-level NAMING CAUTION —
 * and distinct from GeoValidationGateLevel, which is a gate *level* on an
 * IndustryProfile, not a gate *outcome* on a draft.
 */
export type PlatformGate = PassedPlatformGate | FailedPlatformGate;

interface VerticalGateBase {
  id: string;
  clientOrganizationId: string;
  projectId: string;
  /** Discriminant so VerticalGate and PlatformGate are never structurally interchangeable, despite otherwise-identical shapes. */
  gateKind: "VERTICAL_GATE";
  /** The ArticleDraft this gate evaluated. */
  articleDraftId: string;
  /** The IndustryProfile whose vertical-specific rules this gate applied. */
  industryProfileId: string;
  /**
   * The gate level in effect on the IndustryProfile at evaluation time,
   * captured alongside the reference for auditability — same pattern as
   * D2's OpportunityValidation.gateLevelApplied. Expected to be
   * "INDUSTRY_VERTICAL_GATE" for a VerticalGate in practice, but not
   * pinned to that literal here since the type only records what was
   * actually applied, mirroring OpportunityValidation's own field.
   */
  gateLevelApplied: GeoValidationGateLevel;
  status: GateOutcomeStatus;
  evaluatedAt: string;
}

export interface PassedVerticalGate extends VerticalGateBase {
  status: "PASSED";
}

export interface FailedVerticalGate extends VerticalGateBase {
  status: "FAILED";
  /** Required, non-empty: a failed gate must state why, never silently. */
  failureReasons: [string, ...string[]];
}

/**
 * VerticalGate is the outcome of running an ArticleDraft through the
 * IndustryProfile-specific vertical rules (D1's IndustryProfile /
 * GeoValidationGateLevel). Distinct from PlatformGate above — see the
 * file-level NAMING CAUTION.
 */
export type VerticalGate = PassedVerticalGate | FailedVerticalGate;

/**
 * ArticleApproval is the final human approval of an ArticleDraft for
 * publication readiness. Per this checkpoint's requirement (and
 * SYSTEM_INVARIANTS_V1.md's Publication invariant that nothing publishes
 * automatically), an ArticleApproval requires a real, non-optional
 * `approverId` + `approvedAt` (same "no decision without an identity and
 * timestamp" shape as D2's HumanReviewDecision), and is gated on all three
 * of QualityGate, PlatformGate, and VerticalGate having passed: each is
 * referenced by id plus a status field pinned to the literal `"PASSED"` —
 * see the file-level doc comment above for why this makes the gating
 * structural (a compile-time failure to construct with a failed/missing
 * gate), not merely a runtime check.
 */
export interface ArticleApproval {
  id: string;
  clientOrganizationId: string;
  projectId: string;
  /** The ArticleDraft this approval makes publication-ready. */
  articleDraftId: string;
  /** Required, non-optional: no approval may exist without a real approver identity. */
  approverId: string;
  /** Required, non-optional: no approval may exist without an approval timestamp. */
  approvedAt: string;
  /** The QualityGate that authorized this approval. */
  qualityGateId: string;
  /** Pinned to the literal "PASSED" — see the interface doc comment above. */
  qualityGateStatus: "PASSED";
  /** The PlatformGate that authorized this approval. */
  platformGateId: string;
  /** Pinned to the literal "PASSED" — see the interface doc comment above. */
  platformGateStatus: "PASSED";
  /** The VerticalGate that authorized this approval. */
  verticalGateId: string;
  /** Pinned to the literal "PASSED" — see the interface doc comment above. */
  verticalGateStatus: "PASSED";
}

/**
 * Caller-supplied identity/timestamp values for one `evaluateQualityGate`
 * call. Deliberately a separate, explicit input rather than something the
 * function invents internally — see the file-level "Determinism" note
 * above and D4's identical `ArticleDraftCompilationIdentity` pattern.
 */
export interface QualityGateEvaluationIdentity {
  id: string;
  evaluatedAt: string;
}

/**
 * Evaluates an ArticleDraft (and the ArticleBrief it was compiled from)
 * against the deterministic quality checks described in the `QualityGate`
 * doc comment above:
 *
 * 1. Minimum content presence: `draft.sections` is non-empty and every
 *    section has a non-blank `heading`.
 * 2. Required `planningContext` fields present: `brief.planningContext`
 *    itself, plus its non-empty `targetKeywords` and
 *    `authorizingHumanReviewDecisionIds` — all already required by the
 *    ArticleBrief/ArticleBriefPlanningContextV1 contracts (D3), re-checked
 *    here defensively at the runtime boundary the same way
 *    `compileArticleDraft` re-checks `planningContext` in D4.
 * 3. No empty `sourceProviderArticleContentIds` — already a non-empty
 *    tuple at the type level (D4), re-checked here for the same
 *    defensive-boundary reason.
 * 4. `draft.articleBriefId` actually matches `brief.id` (the draft being
 *    graded must be the one compiled from the brief passed in, not an
 *    unrelated pair).
 *
 * Pure, deterministic data transformation only, matching D4's
 * `compileArticleDraft` discipline exactly: zero imports, zero I/O, no
 * provider/network call of any kind, never reads the clock or generates
 * randomness, never mutates its inputs. `id` and `evaluatedAt` are
 * supplied by the caller via `identity` for the same reason D4's
 * `compileArticleDraft` takes an `identity` parameter instead of calling
 * `Date.now()`/generating a uuid itself.
 */
export function evaluateQualityGate(
  draft: ArticleDraft,
  brief: ArticleBrief,
  identity: QualityGateEvaluationIdentity,
): QualityGate {
  const failureReasons: string[] = [];

  if (draft.sections.length === 0) {
    failureReasons.push(
      "ArticleDraft has zero sections; minimum content presence check failed.",
    );
  } else if (draft.sections.some((section) => section.heading.trim().length === 0)) {
    failureReasons.push(
      "ArticleDraft has one or more sections with an empty or blank heading.",
    );
  }

  if (!brief.planningContext) {
    failureReasons.push("ArticleBrief.planningContext is missing.");
  } else {
    if (brief.planningContext.targetKeywords.length === 0) {
      failureReasons.push("ArticleBriefPlanningContextV1.targetKeywords is empty.");
    }
    if (brief.planningContext.authorizingHumanReviewDecisionIds.length === 0) {
      failureReasons.push(
        "ArticleBriefPlanningContextV1.authorizingHumanReviewDecisionIds is empty.",
      );
    }
  }

  if (draft.sourceProviderArticleContentIds.length === 0) {
    failureReasons.push("ArticleDraft.sourceProviderArticleContentIds is empty.");
  }

  if (draft.articleBriefId !== brief.id) {
    failureReasons.push(
      `ArticleDraft.articleBriefId "${draft.articleBriefId}" does not match the evaluated ` +
        `ArticleBrief.id "${brief.id}".`,
    );
  }

  if (failureReasons.length > 0) {
    return {
      id: identity.id,
      clientOrganizationId: draft.clientOrganizationId,
      projectId: draft.projectId,
      articleDraftId: draft.id,
      status: "FAILED",
      failureReasons: failureReasons as [string, ...string[]],
      evaluatedAt: identity.evaluatedAt,
    };
  }

  return {
    id: identity.id,
    clientOrganizationId: draft.clientOrganizationId,
    projectId: draft.projectId,
    articleDraftId: draft.id,
    status: "PASSED",
    evaluatedAt: identity.evaluatedAt,
  };
}
