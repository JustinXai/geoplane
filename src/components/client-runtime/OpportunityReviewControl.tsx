"use client";

/**
 * CLIENT_REVIEW_RUNTIME_V1 (Agent C2) — client review/confirmation of a content opportunity, wired
 * end-to-end to the real command API (POST /api/opportunities/[id]/reviews).
 *
 * The three real client decisions are offered (确认 / 要求修改 / 暂不处理 = CONFIRMED /
 * CHANGES_REQUESTED / DEFERRED); there is no boolean "approve" — never auto-approved. The reviewer is
 * derived from the session server-side: this control sends only the OPAQUE reviewReferenceCode, the
 * version it read, the decision and (where required) a note — never a reviewer / actor / org id, and
 * never a raw internal UUID.
 *
 * The command keys the decision on a validation the client read surface deliberately never exposes as
 * a UUID; instead OpportunityViewV1.review carries the opaque reviewReferenceCode. When `review` is
 * absent (the opportunity is not reviewable) the control renders a clean, disabled affordance rather
 * than fabricating a reference. On success the parent list refreshes (onReviewed) so the new status
 * shows; a stale-version write surfaces a distinct conflict message.
 */
import { useState } from "react";
import type { OpportunityReviewRefV1 } from "../../runtime/api-contracts/index.js";
import {
  type OpportunityReviewDecision,
  submitOpportunityReview,
} from "./commands.js";
import { WriteActionFeedback, useWriteAction } from "./WriteAction.js";

/** Human labels for the three client decisions — 确认 / 要求修改 / 暂不处理. */
export const DECISION_LABELS: Readonly<Record<OpportunityReviewDecision, string>> = {
  CONFIRMED: "确认",
  CHANGES_REQUESTED: "要求修改",
  DEFERRED: "暂不处理",
};

/** Stable presentation order for the decisions. */
export const DECISION_ORDER: readonly OpportunityReviewDecision[] = [
  "CONFIRMED",
  "CHANGES_REQUESTED",
  "DEFERRED",
];

/** These decisions require a note; CONFIRMED does not. */
const DECISIONS_REQUIRING_NOTE: readonly OpportunityReviewDecision[] = [
  "CHANGES_REQUESTED",
  "DEFERRED",
];

export interface OpportunityReviewControlProps {
  /** Opportunity id — opaque action handle (OpportunityViewV1.id); used only for the command path, never rendered. */
  readonly opportunityId: string;
  /**
   * The opaque, client-safe review reference (OpportunityViewV1.review). `undefined` when the
   * opportunity is not reviewable — the control is then disabled (no fabrication). Present enables
   * the real submit; the control never displays any field of it (the code is opaque).
   */
  readonly review: OpportunityReviewRefV1 | undefined;
  /** Refresh the opportunity list after a recorded decision so the new status shows. */
  readonly onReviewed: () => void;
}

export function OpportunityReviewControl({
  opportunityId,
  review,
  onReviewed,
}: OpportunityReviewControlProps) {
  const [note, setNote] = useState("");
  const { state, submit } = useWriteAction(
    (decision: OpportunityReviewDecision) =>
      submitOpportunityReview({
        opportunityId,
        // Guaranteed present at the call site: the buttons are disabled when the reference is absent.
        reviewReferenceCode: review?.reviewReferenceCode ?? "",
        reviewVersion: review?.reviewVersion ?? 0,
        decision,
        ...(DECISIONS_REQUIRING_NOTE.includes(decision) ? { note } : {}),
      }),
    onReviewed,
  );

  const actionable = review !== undefined;
  const submitting = state.status === "submitting";
  const allowed = review?.allowedDecisions ?? [];
  const decisions = actionable ? DECISION_ORDER.filter((d) => allowed.includes(d)) : DECISION_ORDER;

  const isConflict = state.status === "error" && state.code === "CONFLICT";

  function disabledFor(decision: OpportunityReviewDecision): boolean {
    if (!actionable || submitting) return true;
    // Guard: a changes/defer decision needs a note; keep its button disabled until one is entered.
    return DECISIONS_REQUIRING_NOTE.includes(decision) && note.trim() === "";
  }

  return (
    <div className="cp-confirm" role="group" aria-label="内容方向确认">
      <label className="cp-confirm-note">
        <span className="cp-confirm-note-label">评审备注（要求修改/暂不处理时必填）</span>
        <textarea
          className="cp-confirm-note-input"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          disabled={!actionable || submitting}
          rows={2}
          aria-label="评审备注"
        />
      </label>
      <div className="cp-confirm-actions">
        {decisions.map((decision) => (
          <button
            key={decision}
            type="button"
            className="cp-confirm-button"
            onClick={() => submit(decision)}
            disabled={disabledFor(decision)}
            aria-disabled={disabledFor(decision)}
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
      {isConflict ? (
        <p className="cp-callout" role="alert">
          该内容方向已被更新，请刷新后重试。
        </p>
      ) : (
        <WriteActionFeedback state={state} successLabel="已记录你的决定。" />
      )}
    </div>
  );
}
