/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * reconstruction_source: docs/architecture/SYSTEM_BLUEPRINT_V1.md (business core item 2,
 *   "Keyword and user-question mapping" and item 3, "Content and source grounding" -
 *   both call out an explicit client-confirmation step before an item moves forward)
 * reconstruction_reason: no original page/component code recoverable beyond the 7 files
 *   already in recovered/partial-source/
 * original_file_unavailable: true
 *
 * Checkpoint C5: shared client-confirmation view-model for the CLIENT workspace
 * (keyword confirmation, content-direction confirmation, source-type confirmation).
 *
 * `ClientConfirmationDecision` deliberately mirrors the three-state shape of
 * `ClientReviewDecision.decision` from `src/contracts/tenancy/entities.ts` on the
 * separate, not-yet-merged `rebuild/tenancy-auth` branch (CONFIRMED / CHANGES_REQUESTED /
 * DEFERRED, per B1-CORRECTION on that lane) - NOT a boolean/two-state approve shortcut.
 * This lane cannot import that file (cross-branch import, established in checkpoint C3),
 * so the shape is redeclared locally here and kept consistent by convention so the two
 * lanes line up once the branches eventually integrate.
 */

/** The three real decisions a client can make about a confirmable item. */
export type ClientConfirmationDecision = "CONFIRMED" | "CHANGES_REQUESTED" | "DEFERRED";

export const CLIENT_CONFIRMATION_DECISIONS: readonly ClientConfirmationDecision[] = [
  "CONFIRMED",
  "CHANGES_REQUESTED",
  "DEFERRED",
] as const;

/**
 * Sentinel for "no explicit decision made yet". Deliberately a fourth, distinct value -
 * never one of the three real decisions - so a freshly-constructed confirmation item can
 * never be mistaken for (or silently default to) "CONFIRMED".
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
