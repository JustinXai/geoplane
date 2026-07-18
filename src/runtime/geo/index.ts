/**
 * GEO_RUNTIME_SERVICE_PORTS_V1 — public surface of the GEO runtime service
 * layer. Application services over the frozen offline domain contracts, wired
 * to consumer-defined ports (repository/audit/clock/id) so they are fully
 * unit-testable with in-memory fakes and zero database. No provider/network
 * port exists here — Provider Calls = 0 by construction.
 */
export * from "./ports.js";
export type { GeoRuntimeInfra } from "./services/support.js";

export {
  KeywordQuestionService,
  type CreateKnowledgePackageInput,
  type CreateIndustryProfileInput,
  type CreateKeywordQuestionMapInput,
} from "./services/keyword-question-service.js";
export {
  OpportunityService,
  type CreateOpportunityInput,
} from "./services/opportunity-service.js";
export {
  ValidationService,
  type ValidateOpportunityInput,
} from "./services/validation-service.js";
export { HumanReviewService } from "./services/human-review-service.js";
export {
  OpportunityFamilyService,
  type CreateOpportunityFamilyInput,
} from "./services/opportunity-family-service.js";
export {
  ArticleBriefService,
  type CreateArticleBriefInput,
} from "./services/article-brief-service.js";
export { ArticlePipelineService } from "./services/article-pipeline-service.js";
export { QualityGateService } from "./services/quality-gate-service.js";
export { PublishPackageService } from "./services/publish-package-service.js";
export {
  DistributionPlanService,
  type CreateDistributionPlanInput,
} from "./services/distribution-plan-service.js";
export { DeliveryService } from "./services/delivery-service.js";
