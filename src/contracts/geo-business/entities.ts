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
