/**
 * AGENCY_OPS_WORKSPACE_RUNTIME_V1 (batch 1) — public barrel for the AGENCY workspace runtime.
 * Ops-runtime shells are deferred to batch 2 (they need GET /api/ops/organizations + /api/ops/
 * audit, still being built by Agent C).
 */
export {
  getAgencyClients,
  setAgencyContext,
  listAgencyProjects,
  listClientDeliveries,
  listClientReviewQueue,
  listClientKeywordQuestions,
} from "./agency-api.js";
export type { AgencyActingContextV1 } from "./agency-api.js";

export {
  isPortfolioEmpty,
  filterAuthorizedClients,
  isClientAuthorized,
  findAuthorizedClient,
  resolveClientSelection,
} from "./client-portfolio.js";
export type { ClientSelection } from "./client-portfolio.js";

export { toActingBannerView, selectActingBanner } from "./acting-context.js";
export type { ActingBannerView, ActingBannerState } from "./acting-context.js";

export {
  loadAgencyProjectReads,
  totalRows,
  isAggregateEmpty,
} from "./project-reads.js";
export type { AgencyProjectReadGroup, PerProjectReader } from "./project-reads.js";

export { AgencyActingBanner } from "./AgencyActingBanner.js";
export type { AgencyActingBannerProps } from "./AgencyActingBanner.js";

export { AgencyAsyncView } from "./AgencyAsyncView.js";
export type { AgencyAsyncViewProps } from "./AgencyAsyncView.js";
