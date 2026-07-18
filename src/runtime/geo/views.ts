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
  OpportunityStatusV1,
  OpportunityViewV1,
} from "../api-contracts/index.js";
import type {
  HumanReviewDecision,
  KeywordQuestionMap,
  Opportunity,
} from "../../contracts/geo-business/entities.js";
import type {
  DeliveryArticleReadModel,
  OpportunityValidationReadRow,
} from "./pg/geo-read-repository.js";

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
 * Map one Opportunity to the frozen OpportunityViewV1. The keyword is the only
 * client-facing handle the Opportunity carries, so it drives both the title and
 * a plain-language summary; grounding/provenance ids are deliberately not
 * exposed.
 */
export function toOpportunityView(
  opportunity: Opportunity,
  status: OpportunityStatusV1,
): OpportunityViewV1 {
  return {
    id: opportunity.id,
    projectId: opportunity.projectId,
    title: opportunity.keyword,
    summary: `Knowledge-grounded content opportunity for the keyword "${opportunity.keyword}".`,
    status,
    createdAt: opportunity.createdAt,
  };
}

/** Latest validation status per opportunity id (rows arrive oldest-first). */
export function latestValidationStatusByOpportunity(
  validations: readonly OpportunityValidationReadRow[],
): Map<string, OpportunityValidationReadRow["status"]> {
  const out = new Map<string, OpportunityValidationReadRow["status"]>();
  for (const v of validations) out.set(v.opportunityId, v.status);
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

/** Map every opportunity in a scope to its view, deriving status from validations + reviews. */
export function toOpportunityViews(
  opportunities: readonly Opportunity[],
  validations: readonly OpportunityValidationReadRow[],
  reviews: readonly HumanReviewDecision[],
): OpportunityViewV1[] {
  const validationByOpp = latestValidationStatusByOpportunity(validations);
  const reviewByOpp = latestReviewStatusByOpportunity(reviews);
  return opportunities.map((opp) =>
    toOpportunityView(
      opp,
      deriveOpportunityStatus(validationByOpp.get(opp.id), reviewByOpp.get(opp.id)),
    ),
  );
}

/**
 * The review queue: opportunities awaiting a client review decision — those that
 * have passed validation (VALIDATED) but have no HumanReviewDecision yet.
 * Returned as opportunity summaries (OpportunityViewV1), each with status
 * VALIDATED.
 */
export function toReviewQueueViews(
  opportunities: readonly Opportunity[],
  validations: readonly OpportunityValidationReadRow[],
  reviews: readonly HumanReviewDecision[],
): OpportunityViewV1[] {
  const validationByOpp = latestValidationStatusByOpportunity(validations);
  const reviewByOpp = latestReviewStatusByOpportunity(reviews);
  const queue: OpportunityViewV1[] = [];
  for (const opp of opportunities) {
    const validated = validationByOpp.get(opp.id) === "VALIDATED";
    const alreadyReviewed = reviewByOpp.has(opp.id);
    if (validated && !alreadyReviewed) {
      queue.push(toOpportunityView(opp, "VALIDATED"));
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
