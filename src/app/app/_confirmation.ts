/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * reconstruction_source: docs/architecture/SYSTEM_BLUEPRINT_V1.md (business core item 2,
 *   "Keyword and user-question mapping" and item 3, "Content and source grounding" -
 *   both call out an explicit client-confirmation step before an item moves forward),
 *   src/contracts/tenancy/review.ts (canonical ClientReviewDecisionValue)
 * reconstruction_reason: no original page/component code recoverable beyond the 7 files
 *   already in recovered/partial-source/
 * original_file_unavailable: true
 *
 * Checkpoint C5, refactored during REBUILD_INTEGRATION_ACCEPTANCE_V1's canonical
 * contract unification (docs/acceptance/CANONICAL_CONTRACT_UNIFICATION.md): this file
 * used to redeclare its own `ClientConfirmationDecision` union mirroring
 * `ClientReviewDecisionValue` (necessary at the time because this lane's branch could
 * not import across branches). Now that both lanes live in one tree, this file imports
 * the canonical type directly instead of maintaining a parallel duplicate.
 *
 * `NOT_YET_REVIEWED` remains a genuinely UI-only presentation state - there is no
 * "unreviewed" variant of `ClientReviewDecision` on the business/persistence side (an
 * unreviewed item simply has no `ClientReviewDecision` row at all), so this sentinel has
 * no canonical business-layer equivalent to import. Per this phase's mandate, the
 * conversion between the two is explicit: `toReviewDecision`/`fromReviewDecision` below,
 * not an implicit cast.
 */
import type { ClientReviewDecisionValue } from "@/contracts/tenancy/review";

/** Alias kept for call-site readability in this UI module; identical to the canonical type. */
export type ClientConfirmationDecision = ClientReviewDecisionValue;

export const CLIENT_CONFIRMATION_DECISIONS: readonly ClientConfirmationDecision[] = [
  "CONFIRMED",
  "CHANGES_REQUESTED",
  "DEFERRED",
] as const;

/**
 * Sentinel for "no explicit decision made yet". Deliberately a fourth, distinct value -
 * never one of the three real decisions - so a freshly-constructed confirmation item can
 * never be mistaken for (or silently default to) "CONFIRMED". UI-only: has no canonical
 * business-layer (`ClientReviewDecision`) equivalent - see file header.
 */
export const NOT_YET_REVIEWED = "NOT_YET_REVIEWED" as const;

export type ClientConfirmationState = ClientConfirmationDecision | typeof NOT_YET_REVIEWED;

export const CLIENT_CONFIRMATION_LABELS: Readonly<Record<ClientConfirmationState, string>> = {
  CONFIRMED: "确认",
  CHANGES_REQUESTED: "需要修改",
  DEFERRED: "待定",
  NOT_YET_REVIEWED: "待客户确认",
};

/** Every confirmable item starts here - explicit "not yet decided", never a real decision. */
export function createInitialConfirmationState(): ClientConfirmationState {
  return NOT_YET_REVIEWED;
}

/**
 * Applies an explicit client decision. This is a pure state transition only - it does not
 * submit anywhere. Wiring a real submit handler is out of scope for this checkpoint (see
 * every prior checkpoint's fixture-only rule).
 */
export function applyClientConfirmationDecision(
  decision: ClientConfirmationDecision,
): ClientConfirmationState {
  return decision;
}

/**
 * Explicit UI-state -> canonical-business-type conversion, per this phase's mandate that
 * `NOT_YET_REVIEWED` "必须与业务 Decision 明确转换" (must have an explicit conversion
 * to/from the business Decision). Returns `null` for the not-yet-reviewed sentinel,
 * matching the business-layer reality that an unreviewed item has no
 * `ClientReviewDecision` row - never fabricates a placeholder decision value.
 */
export function toReviewDecision(state: ClientConfirmationState): ClientReviewDecisionValue | null {
  return state === NOT_YET_REVIEWED ? null : state;
}

/**
 * The inverse conversion: a real (or absent) business decision -> UI presentation state.
 */
export function fromReviewDecision(decision: ClientReviewDecisionValue | null): ClientConfirmationState {
  return decision ?? NOT_YET_REVIEWED;
}
