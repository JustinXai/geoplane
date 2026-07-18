/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * reconstruction_source: src/contracts/tenancy/entities.ts (checkpoint B1-CORRECTION)
 * reconstruction_reason: acceptance-phase canonical contract unification -
 *   this file did not exist during the overnight rebuild; it is a curated
 *   re-export introduced during REBUILD_INTEGRATION_ACCEPTANCE_V1 so
 *   `src/contracts/index.ts` can expose a focused `review` namespace
 *   without physically splitting entities.ts (a 200-line file with tight
 *   internal coupling between Organization/Membership/ClientReviewDecision -
 *   splitting it would be a much larger, riskier change than this
 *   acceptance phase's time budget justifies).
 * original_file_unavailable: n/a (net-new acceptance-phase file)
 *
 * Canonical review-decision surface. Every lane that needs the client
 * three-state review shape (CONFIRMED / CHANGES_REQUESTED / DEFERRED) must
 * import from here (or from tenancy/entities.ts directly) - never
 * redeclare an equivalent union under a local name. See
 * docs/acceptance/CANONICAL_CONTRACT_UNIFICATION.md for the audit of every
 * duplicate this eliminated.
 */
export type {
  ClientReviewDecision,
  ClientReviewDecisionValue,
} from "./entities.js";
