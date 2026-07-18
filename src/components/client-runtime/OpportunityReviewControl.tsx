"use client";

/**
 * CLIENT_WORKSPACE_RUNTIME_V1 (Agent D — batch 2) — client review/confirmation of a content
 * opportunity, wired to the real command API (POST /api/opportunities/[id]/reviews).
 *
 * The three real decisions the command accepts are offered (确认 / 需要修改 / 否决); there is no
 * boolean "approve" — never auto-approved. On success the parent list refreshes (onReviewed) so the
 * opportunity's new status shows. The reviewer is derived from the session server-side: this control
 * sends only the decision (+ a note where the command requires one) — never a reviewer / actor / org id.
 *
 * The command keys the decision on a specific validation reference (opportunityValidationId). The
 * client read surface (OpportunityViewV1) deliberately does not expose that internal reference — so
 * when it is unavailable this control renders a clean, disabled affordance rather than fabricating an
 * id. Passing a real reference (once a client-facing read surfaces one) enables it with no other change.
 */
import { useState } from "react";
import {
  type OpportunityReviewDecision,
  submitOpportunityReview,
} from "./commands.js";
import { WriteActionFeedback, useWriteAction } from "./WriteAction.js";

const DECISION_LABELS: Readonly<Record<OpportunityReviewDecision, string>> = {
  CONFIRMED: "确认",
  CHANGES_REQUESTED: "需要修改",
  REJECTED: "否决",
};

/** These decisions require a note; CONFIRMED does not. */
const DECISION_ORDER: readonly OpportunityReviewDecision[] = [
  "CONFIRMED",
  "CHANGES_REQUESTED",
  "REJECTED",
];

export interface OpportunityReviewControlProps {
  /** Opaque action handle (OpportunityViewV1.id); used only for the command path, never rendered. */
  readonly opportunityId: string;
  /**
   * The validation reference the decision acts on. `null` when the client read surface does not
   * expose one — the control is then disabled (no fabrication). Non-null enables the real submit.
   */
  readonly opportunityValidationId: string | null;
  /** Refresh the opportunity list after a recorded decision so the new status shows. */
  readonly onReviewed: () => void;
}

export function OpportunityReviewControl({
  opportunityId,
  opportunityValidationId,
  onReviewed,
}: OpportunityReviewControlProps) {
  const [note, setNote] = useState("");
  const { state, submit } = useWriteAction(
    (decision: OpportunityReviewDecision) =>
      submitOpportunityReview({
        opportunityId,
        // Guaranteed non-null at the call site: the buttons are disabled when the reference is absent.
        opportunityValidationId: opportunityValidationId ?? "",
        decision,
        ...(decision === "CONFIRMED" ? {} : { note }),
      }),
    onReviewed,
  );

  const actionable = opportunityValidationId !== null;
  const submitting = state.status === "submitting";
  const disabled = !actionable || submitting;

  return (
    <div className="cp-confirm" role="group" aria-label="内容方向确认">
      <div className="cp-confirm-actions">
        {DECISION_ORDER.map((decision) => (
          <button
            key={decision}
            type="button"
            className="cp-confirm-button"
            onClick={() => submit(decision)}
            disabled={disabled}
            aria-disabled={disabled}
          >
            {DECISION_LABELS[decision]}
          </button>
        ))}
      </div>
      {!actionable ? (
        <p className="cp-placeholder-note" role="note">
          该内容方向的确认待评审就绪后开放。
        </p>
      ) : null}
      <WriteActionFeedback state={state} successLabel="已记录你的决定。" />
    </div>
  );
}
