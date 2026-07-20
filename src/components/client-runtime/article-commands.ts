/**
 * CLIENT_WORKSPACE_RUNTIME_V1 — typed WRITE-action wrappers for article briefs and drafts
 * in the CLIENT workspace, built on F1's ApiClient (src/lib/api-client/http.ts) and the
 * real command routes from BUSINESS_COMMAND_API_V1.
 *
 * SERVER-DERIVED ACTOR: the agency actor identity is resolved server-side from the session.
 * These helpers therefore NEVER accept, build, or send a client-supplied actor/organization
 * id in the request body. Each helper posts to a real route and returns the same Result
 * the read loaders use.
 */
import type { ArticleBriefViewV1, ArticleDraftCommandViewV1, ArticleApprovalViewV1 } from "../../runtime/commands/geo-dto.js";
import { type ApiClient, defaultApiClient, type Result } from "../../lib/api-client/http.js";

function enc(segment: string): string {
  return encodeURIComponent(segment);
}

// ---------------------------------------------------------------------------
// Article Brief creation — POST /api/article-briefs
// ---------------------------------------------------------------------------

export interface CreateBriefInput {
  readonly opportunityFamilyId: string;
  readonly workingTitle: string;
  readonly outline: readonly string[];
  readonly targetKeywords: readonly string[];
  readonly riskLevel: "STANDARD" | "ESCALATED_FOR_HUMAN_REVIEW";
}

/**
 * Creates a planning brief from an OpportunityFamily. The brief is immutable once created.
 * Server-side tenant resolution via the family; body carries no org id.
 */
export function createArticleBrief(
  input: CreateBriefInput,
  client: ApiClient = defaultApiClient,
): Promise<Result<ArticleBriefViewV1>> {
  return client.request<ArticleBriefViewV1>("/api/article-briefs", {
    method: "POST",
    body: {
      opportunityFamilyId: input.opportunityFamilyId,
      workingTitle: input.workingTitle,
      outline: [...input.outline],
      targetKeywords: [...input.targetKeywords],
      riskLevel: input.riskLevel,
    },
  });
}

// ---------------------------------------------------------------------------
// Article Draft compilation — POST /api/article-drafts/compile
// ---------------------------------------------------------------------------

export interface CompileDraftInput {
  readonly articleBriefId: string;
  readonly providerResponseEnvelopeId: string;
}

/**
 * Compiles a DraftArticleDraft from an ArticleBrief and its ingested provider content.
 * Each call produces a NEW draft with an incremented version; no existing draft is mutated.
 */
export function compileArticleDraft(
  input: CompileDraftInput,
  client: ApiClient = defaultApiClient,
): Promise<Result<ArticleDraftCommandViewV1>> {
  return client.request<ArticleDraftCommandViewV1>("/api/article-drafts/compile", {
    method: "POST",
    body: {
      articleBriefId: input.articleBriefId,
      providerResponseEnvelopeId: input.providerResponseEnvelopeId,
    },
  });
}

// ---------------------------------------------------------------------------
// Article Draft review submission — POST /api/article-drafts/[id]/reviews
// ---------------------------------------------------------------------------

export interface SubmitDraftReviewInput {
  readonly articleDraftId: string;
  readonly industryProfileId: string;
}

/**
 * Evaluates the three publication gates (quality, platform, vertical) for a draft and,
 * only if all three PASS, records the final ArticleApproval. NEVER auto-approved.
 * The approver is resolved server-side from the authenticated session.
 */
export function submitDraftReview(
  input: SubmitDraftReviewInput,
  client: ApiClient = defaultApiClient,
): Promise<Result<ArticleApprovalViewV1>> {
  return client.request<ArticleApprovalViewV1>(
    `/api/article-drafts/${enc(input.articleDraftId)}/reviews`,
    {
      method: "POST",
      body: {
        industryProfileId: input.industryProfileId,
      },
    },
  );
}
