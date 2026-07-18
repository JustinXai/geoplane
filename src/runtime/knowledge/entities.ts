/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC (net-new runtime-phase file)
 * reconstruction_source: docs/architecture/GEO_BUSINESS_CHAIN_V1.md (chain step 1,
 *   "Knowledge package / enterprise knowledge base ingestion"),
 *   src/runtime/api-contracts/index.ts (FROZEN KnowledgePackageStatusV1 /
 *   KnowledgeIssueKindV1 / KnowledgeIssueSeverityV1 - enum string values here are chosen
 *   identical so a future API route maps rows -> DTO with no value translation),
 *   migrations/0002_knowledge_runtime.sql (the real schema these types mirror).
 * reconstruction_reason: KNOWLEDGE_SCHEMA_AND_PORTS_V1 checkpoint - domain entity types
 *   for the knowledge-ingestion chain, persisted by the ports in ./ports.ts.
 * original_file_unavailable: n/a (net-new runtime-phase file)
 *
 * NOTE (GEO_BUSINESS_CHAIN_V1 caution): the owner-recalled PascalCase names for this chain
 *   had zero literal hits in recovered evidence. These interfaces are implemented against the
 *   chain DESCRIPTION and the frozen API contract, not a recovered source file.
 *
 * Timestamp fields are ISO-8601 strings (the repositories map Postgres TIMESTAMPTZ via
 * Date.toISOString()), matching the persistence-layer convention in src/persistence/pg/*.
 */

// ---------------------------------------------------------------------------
// Enums (string values aligned with the frozen api-contracts view DTOs)
// ---------------------------------------------------------------------------

/** DRAFT -> IN_REVIEW -> CONFIRMED. Matches KnowledgePackageStatusV1. */
export type KnowledgePackageStatus = "DRAFT" | "IN_REVIEW" | "CONFIRMED";

/**
 * Public-scope / confidentiality classification. PUBLIC content is publishable;
 * stricter tiers gate downstream usage. Also the "public-scope" concept from the
 * business chain.
 */
export type KnowledgeClassification =
  | "PUBLIC"
  | "INTERNAL"
  | "CONFIDENTIAL"
  | "RESTRICTED";

/** Where a document originated. */
export type KnowledgeDocumentSourceKind =
  | "FILE"
  | "URL"
  | "MANUAL"
  | "INTEGRATION";

/**
 * Quality-finding kind. MISSING_INFORMATION is the "knowledge gap" concept;
 * the other three are the unverified-fact, forbidden-usage and classification
 * concepts. Matches KnowledgeIssueKindV1.
 */
export type KnowledgeIssueKind =
  | "MISSING_INFORMATION"
  | "UNVERIFIED_FACT"
  | "FORBIDDEN_USAGE"
  | "CLASSIFICATION_NEEDED";

/** Matches KnowledgeIssueSeverityV1. */
export type KnowledgeIssueSeverity = "INFO" | "WARNING" | "BLOCKER";

// ---------------------------------------------------------------------------
// Entities (one interface per 0002 table)
// ---------------------------------------------------------------------------

/** knowledge_package - the per-project enterprise knowledge base container. */
export interface KnowledgePackage {
  readonly id: string;
  readonly clientOrganizationId: string;
  readonly projectId: string;
  readonly title: string;
  readonly status: KnowledgePackageStatus;
  /** Public-scope of the package as a whole. */
  readonly classification: KnowledgeClassification;
  readonly createdByUserId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Set together with confirmedByUserId iff status === "CONFIRMED". */
  readonly confirmedAt: string | null;
  readonly confirmedByUserId: string | null;
}

/** knowledge_document - a single source item within a package. */
export interface KnowledgeDocument {
  readonly id: string;
  readonly clientOrganizationId: string;
  readonly projectId: string;
  readonly packageId: string;
  readonly title: string;
  readonly sourceKind: KnowledgeDocumentSourceKind;
  /** Highest version_number appended so far; 0 means no version yet. */
  readonly currentVersionNumber: number;
  readonly createdByUserId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** knowledge_version - an append-only revision of a document's raw content. */
export interface KnowledgeVersion {
  readonly id: string;
  readonly clientOrganizationId: string;
  readonly projectId: string;
  readonly packageId: string;
  readonly documentId: string;
  readonly versionNumber: number;
  /** Storage reference to the raw bytes (parsing is a later checkpoint). */
  readonly storagePath: string | null;
  readonly contentHash: string;
  readonly byteSize: number | null;
  readonly mimeType: string | null;
  readonly createdByUserId: string;
  readonly createdAt: string;
}

/** knowledge_issue - a quality finding gating package confirmation. */
export interface KnowledgeIssue {
  readonly id: string;
  readonly clientOrganizationId: string;
  readonly projectId: string;
  readonly packageId: string;
  /** Optionally pinned to a single document. */
  readonly documentId: string | null;
  readonly kind: KnowledgeIssueKind;
  readonly severity: KnowledgeIssueSeverity;
  readonly message: string;
  readonly resolved: boolean;
  /** Set together with resolvedByUserId iff resolved === true. */
  readonly resolvedAt: string | null;
  readonly resolvedByUserId: string | null;
  readonly createdByUserId: string;
  readonly createdAt: string;
}

/** knowledge_snapshot - an immutable sealed capture of a confirmed package. */
export interface KnowledgeSnapshot {
  readonly id: string;
  readonly clientOrganizationId: string;
  readonly projectId: string;
  readonly packageId: string;
  readonly snapshotNumber: number;
  readonly contentHash: string;
  readonly documentCount: number;
  readonly classification: KnowledgeClassification;
  /** null = current/active snapshot; set when a newer snapshot supersedes it. */
  readonly supersededAt: string | null;
  readonly createdByUserId: string;
  readonly createdAt: string;
}

/** enterprise_profile - the canonical identity of a CLIENT enterprise. */
export interface EnterpriseProfile {
  readonly id: string;
  readonly clientOrganizationId: string;
  readonly legalName: string;
  readonly displayName: string | null;
  readonly primaryDomain: string | null;
  readonly industry: string | null;
  readonly description: string | null;
  /** Default public-scope for knowledge created under this enterprise. */
  readonly defaultClassification: KnowledgeClassification;
  /** Free-text statement of usage the enterprise forbids (forbidden-usage). */
  readonly forbiddenUsage: string | null;
  readonly createdByUserId: string;
  readonly createdAt: string;
  readonly updatedByUserId: string;
  readonly updatedAt: string;
}

// ---------------------------------------------------------------------------
// Aggregate read-model (getPackageWithCounts)
// ---------------------------------------------------------------------------

/** A package plus the derived counts a list/detail view needs. */
export interface KnowledgePackageWithCounts extends KnowledgePackage {
  readonly documentCount: number;
  readonly openIssueCount: number;
}
