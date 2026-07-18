/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC (net-new runtime-phase file)
 * reconstruction_reason: CORE_RUNTIME_TRUE_PARALLEL_EXECUTION_V1 §5 — the FROZEN cross-lane
 *   API contract. Agent A owns this file exclusively. Every runtime API route (Agents C/D/E)
 *   and the typed frontend client (Agent F) MUST import these DTOs and the response envelope
 *   from here; no lane may invent a parallel/duplicate DTO for the same concept.
 * original_file_unavailable: n/a (net-new runtime-phase file)
 *
 * Client-surface safety (SYSTEM_INVARIANTS_V1.md): these are presentation view-models. They
 * carry stable ids and human-facing fields only — never Chunk/Embedding/Artifact-hash/Schema/
 * Candidate/Brief internals on client-facing views.
 */
import type {
  ClientReviewDecisionValue,
  OrganizationType,
  PlatformRole,
} from "../../contracts/tenancy/entities.js";

// ---------------------------------------------------------------------------
// Response envelope
// ---------------------------------------------------------------------------

export type ApiErrorCodeV1 =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_FAILED"
  | "CONFLICT"
  | "INTERNAL_ERROR";

/** Maps an ApiErrorCodeV1 to the HTTP status a route should return. */
export const API_ERROR_HTTP_STATUS: Record<ApiErrorCodeV1, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_FAILED: 422,
  CONFLICT: 409,
  INTERNAL_ERROR: 500,
};

export interface ApiSuccessV1<T> {
  readonly ok: true;
  readonly data: T;
}

export interface ApiErrorV1 {
  readonly ok: false;
  readonly error: {
    readonly code: ApiErrorCodeV1;
    readonly message: string;
    readonly details?: Record<string, unknown>;
  };
}

export type ApiResponseV1<T> = ApiSuccessV1<T> | ApiErrorV1;

export interface PaginationV1 {
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
}

export interface PaginatedV1<T> {
  readonly items: readonly T[];
  readonly pagination: PaginationV1;
}

export function apiOk<T>(data: T): ApiSuccessV1<T> {
  return { ok: true, data };
}

export function apiErr(
  code: ApiErrorCodeV1,
  message: string,
  details?: Record<string, unknown>,
): ApiErrorV1 {
  return { ok: false, error: details ? { code, message, details } : { code, message } };
}

// ---------------------------------------------------------------------------
// View DTOs
// ---------------------------------------------------------------------------

export type WorkspaceSurfaceV1 = "client" | "agency" | "ops";

export interface AccountViewV1 {
  readonly userId: string;
  readonly email: string;
  readonly displayName: string | null;
  readonly role: PlatformRole;
  readonly surface: WorkspaceSurfaceV1;
  readonly organizationId: string;
  readonly organizationName: string;
  readonly organizationType: OrganizationType;
  /** Non-null only for a CLIENT_OWNER: their single fixed active client org. */
  readonly activeClientOrganizationId: string | null;
}

export interface ProjectViewV1 {
  readonly id: string;
  readonly name: string;
  readonly clientOrganizationId: string;
  readonly clientOrganizationName: string;
  readonly createdAt: string;
}

export type KnowledgePackageStatusV1 = "DRAFT" | "IN_REVIEW" | "CONFIRMED";

export interface KnowledgePackageViewV1 {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly status: KnowledgePackageStatusV1;
  readonly documentCount: number;
  readonly openIssueCount: number;
  readonly updatedAt: string;
  readonly confirmedAt: string | null;
}

export type KnowledgeIssueKindV1 =
  | "MISSING_INFORMATION"
  | "UNVERIFIED_FACT"
  | "FORBIDDEN_USAGE"
  | "CLASSIFICATION_NEEDED";

export type KnowledgeIssueSeverityV1 = "INFO" | "WARNING" | "BLOCKER";

export interface KnowledgeIssueViewV1 {
  readonly id: string;
  readonly packageId: string;
  readonly kind: KnowledgeIssueKindV1;
  readonly severity: KnowledgeIssueSeverityV1;
  readonly message: string;
  readonly resolved: boolean;
}

export interface KeywordQuestionViewV1 {
  readonly keyword: string;
  readonly userQuestions: readonly string[];
  readonly priority: number;
}

export type OpportunityStatusV1 = "PROPOSED" | "VALIDATED" | "CONFIRMED" | "REJECTED";

/** Review lifecycle status shown to the client (PENDING plus the three decision outcomes). */
export type ReviewStatusV1 = "PENDING" | ClientReviewDecisionValue;

/**
 * Client-safe handle for submitting a review decision on an opportunity. `reviewReferenceCode`
 * is an OPAQUE code the client passes back to the review command — it is NEVER an internal UUID
 * (the server maps it to the real validation/decision id). Client surfaces show none of the
 * internal ids behind it.
 */
export interface OpportunityReviewRefV1 {
  readonly reviewReferenceCode: string;
  readonly reviewVersion: number;
  readonly reviewStatus: ReviewStatusV1;
  readonly allowedDecisions: readonly ClientReviewDecisionValue[];
}

export interface OpportunityViewV1 {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly summary: string;
  readonly status: OpportunityStatusV1;
  readonly createdAt: string;
  /** Present when the opportunity is reviewable by the client; enables the confirm/changes/defer action. */
  readonly review?: OpportunityReviewRefV1;
}

export interface ClientReviewDecisionViewV1 {
  readonly id: string;
  readonly subjectId: string;
  readonly decision: ClientReviewDecisionValue;
  readonly note: string | null;
  readonly decidedAt: string;
  readonly decidedByDisplayName: string | null;
}

export type ArticleDeliveryStatusV1 =
  | "IN_PRODUCTION"
  | "IN_REVIEW"
  | "APPROVED"
  | "DELIVERED";

export interface ArticleDeliveryViewV1 {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly status: ArticleDeliveryStatusV1;
  readonly deliveredAt: string | null;
  readonly publicationRegisteredAt: string | null;
}

export interface AgencyClientPortfolioItemV1 {
  readonly clientOrganizationId: string;
  readonly clientOrganizationName: string;
  readonly projectCount: number;
  readonly openReviewCount: number;
}

export interface AgencyClientPortfolioViewV1 {
  readonly agencyOrganizationId: string;
  readonly agencyOrganizationName: string;
  readonly clients: readonly AgencyClientPortfolioItemV1[];
}

export interface AuditEventViewV1 {
  readonly id: string;
  readonly action: string;
  readonly actorDisplayName: string | null;
  readonly clientOrganizationId: string | null;
  readonly projectId: string | null;
  readonly targetType: string | null;
  readonly occurredAt: string;
}
