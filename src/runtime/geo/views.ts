/**
 * GEO_READ_API_V1 (Agent E4) — entity -> frozen-DTO mappers for the GEO read
 * routes.
 *
 * Client-surface safety (SYSTEM_INVARIANTS_V1): these mappers copy ONLY the
 * human-facing fields the frozen DTOs declare. The internal grounding/provenance
 * facts an Opportunity carries — keywordQuestionMapId, groundingKnowledgePackage
 * id + version — are never read into a view; likewise the delivery view surfaces
 * a human title + lifecycle status only, never the publish-package / distribution
 * / receipt internal ids or any brief/artifact/hash/schema/candidate/chunk jargon.
 */
import type {
  ArticleDeliveryStatusV1,
  ArticleDeliveryViewV1,
  KeywordQuestionViewV1,
  OpportunityReviewRefV1,
  OpportunityStatusV1,
  OpportunityViewV1,
} from "../api-contracts/index.js";
import type { ClientReviewDecisionValue } from "../../contracts/tenancy/entities.js";
import type {
  HumanReviewDecision,
  KeywordQuestionMap,
  Opportunity,
} from "../../contracts/geo-business/entities.js";
import type {
  DeliveryArticleReadModel,
  OpportunityValidationReadRow,
} from "./pg/geo-read-repository.js";
import { encodeReviewReferenceCode } from "./review-reference.js";

/** The three client-facing decisions a reviewable opportunity offers (frozen ClientReviewDecisionValue). */
const ALL_CLIENT_DECISIONS: readonly ClientReviewDecisionValue[] = [
  "CONFIRMED",
  "CHANGES_REQUESTED",
  "DEFERRED",
];

// ---------------------------------------------------------------------------
// Keyword-question views
// ---------------------------------------------------------------------------

/**
 * Flatten every KeywordQuestionMap's entries (in scope order) into the frozen
 * KeywordQuestionViewV1[]. Priority is the 1-based position in that stable order
 * (lower = surfaced first), so the frontend has a deterministic ordering without
 * exposing any map/knowledge-package internal id.
 */
export function toKeywordQuestionViews(
  maps: readonly KeywordQuestionMap[],
): KeywordQuestionViewV1[] {
  const views: KeywordQuestionViewV1[] = [];
  let priority = 1;
  for (const map of maps) {
    for (const entry of map.entries) {
      views.push({
        keyword: entry.keyword,
        userQuestions: [...entry.questions],
        priority,
      });
      priority += 1;
    }
  }
  return views;
}

// ---------------------------------------------------------------------------
// Opportunity views + status derivation
// ---------------------------------------------------------------------------

/**
 * The client-facing lifecycle status of an opportunity, derived from the chain:
 * a human review decision (if any) wins over a validation outcome, which wins
 * over the default PROPOSED. CHANGES_REQUESTED keeps the opportunity in the
 * VALIDATED (active, awaiting a fresh decision) bucket rather than inventing a
 * status the frozen DTO does not carry.
 */
export function deriveOpportunityStatus(
  validationStatus: OpportunityValidationReadRow["status"] | undefined,
  reviewStatus: HumanReviewDecision["status"] | undefined,
): OpportunityStatusV1 {
  if (reviewStatus === "APPROVED") return "CONFIRMED";
  if (reviewStatus === "REJECTED") return "REJECTED";
  if (reviewStatus === "CHANGES_REQUESTED") return "VALIDATED";
  if (validationStatus === "VALIDATED") return "VALIDATED";
  if (validationStatus === "REJECTED") return "REJECTED";
  return "PROPOSED";
}

/**
 * Map one Opportunity to the frozen OpportunityViewV1. The frozen schema still
 * stores its legacy anchor in `keyword`; for knowledge-first opportunities this
 * can be a content-opportunity label, not a confirmed keyword. Client surfaces
 * therefore present it as a content direction and never as confirmed demand.
 * Grounding/provenance ids are deliberately not exposed. `review` is attached
 * only when the opportunity is reviewable — it carries the OPAQUE
 * reviewReferenceCode, never a raw validation UUID.
 */
export function toOpportunityView(
  opportunity: Opportunity,
  status: OpportunityStatusV1,
  review?: OpportunityReviewRefV1,
): OpportunityViewV1 {
  const base: OpportunityViewV1 = {
    id: opportunity.id,
    projectId: opportunity.projectId,
    title: opportunity.keyword,
    summary: `基于企业知识库整理的内容方向：${opportunity.keyword}。确认后可进入内容生产与交付流程。`,
    status,
    createdAt: opportunity.createdAt,
  };
  return review ? { ...base, review } : base;
}

/** Latest validation status per opportunity id (rows arrive oldest-first). */
export function latestValidationStatusByOpportunity(
  validations: readonly OpportunityValidationReadRow[],
): Map<string, OpportunityValidationReadRow["status"]> {
  const out = new Map<string, OpportunityValidationReadRow["status"]>();
  for (const v of validations) out.set(v.opportunityId, v.status);
  return out;
}

/** Latest full validation row per opportunity id (rows arrive oldest-first; last wins). */
export function latestValidationByOpportunity(
  validations: readonly OpportunityValidationReadRow[],
): Map<string, OpportunityValidationReadRow> {
  const out = new Map<string, OpportunityValidationReadRow>();
  for (const v of validations) out.set(v.opportunityId, v);
  return out;
}

/** Latest review status per opportunity id (rows arrive oldest-first). */
export function latestReviewStatusByOpportunity(
  reviews: readonly HumanReviewDecision[],
): Map<string, HumanReviewDecision["status"]> {
  const out = new Map<string, HumanReviewDecision["status"]>();
  for (const r of reviews) out.set(r.opportunityId, r.status);
  return out;
}

/** All review decisions per opportunity id, in arrival order (oldest-first). */
export function reviewsByOpportunity(
  reviews: readonly HumanReviewDecision[],
): Map<string, HumanReviewDecision[]> {
  const out = new Map<string, HumanReviewDecision[]>();
  for (const r of reviews) {
    const list = out.get(r.opportunityId);
    if (list) list.push(r);
    else out.set(r.opportunityId, [r]);
  }
  return out;
}

/**
 * Builds the client-safe review reference for one opportunity, or undefined when it is NOT reviewable.
 *
 * An opportunity is reviewable iff its latest validation is VALIDATED AND it is not in a terminal
 * reviewed state: with no decision yet (PENDING) or with the latest decision being CHANGES_REQUESTED
 * (still awaiting a fresh decision). A terminal APPROVED (client CONFIRMED) or REJECTED (client
 * DEFERRED) closes the review, so no reference is emitted. `reviewVersion` is the count of decisions
 * recorded so far (0 = pending) — the optimistic-concurrency token the command re-checks on write.
 */
function buildReviewReference(
  latestValidation: OpportunityValidationReadRow | undefined,
  decisions: readonly HumanReviewDecision[],
): OpportunityReviewRefV1 | undefined {
  if (!latestValidation || latestValidation.status !== "VALIDATED") return undefined;

  const reviewVersion = decisions.length;
  const latest = reviewVersion > 0 ? decisions[reviewVersion - 1] : undefined;
  // Terminal outcomes (APPROVED / REJECTED) close the review; only PENDING / CHANGES_REQUESTED stay open.
  if (latest !== undefined && latest.status !== "CHANGES_REQUESTED") return undefined;

  return {
    reviewReferenceCode: encodeReviewReferenceCode(latestValidation.validationId),
    reviewVersion,
    reviewStatus: latest === undefined ? "PENDING" : "CHANGES_REQUESTED",
    allowedDecisions: ALL_CLIENT_DECISIONS,
  };
}

/** Map every opportunity in a scope to its view, deriving status + attaching a review ref where reviewable. */
export function toOpportunityViews(
  opportunities: readonly Opportunity[],
  validations: readonly OpportunityValidationReadRow[],
  reviews: readonly HumanReviewDecision[],
): OpportunityViewV1[] {
  const validationByOpp = latestValidationByOpportunity(validations);
  const decisionsByOpp = reviewsByOpportunity(reviews);
  return opportunities.map((opp) => {
    const latestValidation = validationByOpp.get(opp.id);
    const decisions = decisionsByOpp.get(opp.id) ?? [];
    const latestDecision = decisions.length > 0 ? decisions[decisions.length - 1] : undefined;
    const status = deriveOpportunityStatus(latestValidation?.status, latestDecision?.status);
    return toOpportunityView(opp, status, buildReviewReference(latestValidation, decisions));
  });
}

/**
 * The review queue: opportunities awaiting a client review decision — those that
 * have passed validation (VALIDATED) but have no HumanReviewDecision yet.
 * Returned as opportunity summaries (OpportunityViewV1), each with status
 * VALIDATED and the opaque review reference that enables the client action.
 */
export function toReviewQueueViews(
  opportunities: readonly Opportunity[],
  validations: readonly OpportunityValidationReadRow[],
  reviews: readonly HumanReviewDecision[],
): OpportunityViewV1[] {
  const validationByOpp = latestValidationByOpportunity(validations);
  const decisionsByOpp = reviewsByOpportunity(reviews);
  const queue: OpportunityViewV1[] = [];
  for (const opp of opportunities) {
    const latestValidation = validationByOpp.get(opp.id);
    const decisions = decisionsByOpp.get(opp.id) ?? [];
    const validated = latestValidation?.status === "VALIDATED";
    const alreadyReviewed = decisions.length > 0;
    if (validated && !alreadyReviewed) {
      queue.push(toOpportunityView(opp, "VALIDATED", buildReviewReference(latestValidation, decisions)));
    }
  }
  return queue;
}

// ---------------------------------------------------------------------------
// Delivery views
// ---------------------------------------------------------------------------

/**
 * Derive the client-facing delivery lifecycle status from the read model's raw
 * facts: a recorded delivery is DELIVERED; else a human approval is APPROVED;
 * else any recorded gate outcome is IN_REVIEW; else the article is still
 * IN_PRODUCTION.
 */
export function deriveArticleDeliveryStatus(
  model: DeliveryArticleReadModel,
): ArticleDeliveryStatusV1 {
  if (model.deliveredAt !== null) return "DELIVERED";
  if (model.approved) return "APPROVED";
  if (model.inReview) return "IN_REVIEW";
  return "IN_PRODUCTION";
}

/** Map one delivery-centre read model to the frozen ArticleDeliveryViewV1. */
export function toArticleDeliveryView(
  model: DeliveryArticleReadModel,
): ArticleDeliveryViewV1 {
  return {
    id: model.articleDraftId,
    projectId: model.projectId,
    title: model.title,
    status: deriveArticleDeliveryStatus(model),
    deliveredAt: model.deliveredAt,
    publicationRegisteredAt: model.publicationRegisteredAt,
  };
}

export function toArticleDeliveryViews(
  models: readonly DeliveryArticleReadModel[],
): ArticleDeliveryViewV1[] {
  return models.map(toArticleDeliveryView);
}
