/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * reconstruction_source: docs/architecture/SYSTEM_BLUEPRINT_V1.md (business core items 2
 *   and 3 - client confirmation step for keyword mapping and content/source grounding)
 * reconstruction_reason: no original component code recoverable beyond the 7 files
 *   already in recovered/partial-source/
 * original_file_unavailable: true
 *
 * Checkpoint C5: shared, presentation-only client-confirmation control. Offers exactly
 * the three real outcomes in `./_confirmation.ts` (确认 / 需要修改 / 待定) - never a
 * boolean approve checkbox - and visibly reflects whichever state it is currently in.
 * This is a real (client-side only) state transition backed by React `useState`, not a
 * static mockup, but it has no submit handler and touches no backend, matching every
 * prior checkpoint's fixture-only rule.
 */
"use client";

import { useState } from "react";
import {
  CLIENT_CONFIRMATION_DECISIONS,
  CLIENT_CONFIRMATION_LABELS,
  type ClientConfirmationDecision,
  type ClientConfirmationState,
  applyClientConfirmationDecision,
  createInitialConfirmationState,
} from "./_confirmation";

export function ClientConfirmationControl({ subjectLabel }: { subjectLabel: string }) {
  const [state, setState] = useState<ClientConfirmationState>(createInitialConfirmationState);

  function handleDecision(decision: ClientConfirmationDecision) {
    setState(applyClientConfirmationDecision(decision));
  }

  return (
    <div className="cp-confirm" role="group" aria-label={`${subjectLabel}确认`}>
      <span className="cp-confirm-status" data-state={state}>
        {subjectLabel}状态：{CLIENT_CONFIRMATION_LABELS[state]}
      </span>
      <div className="cp-confirm-actions">
        {CLIENT_CONFIRMATION_DECISIONS.map((decision) => (
          <button
            key={decision}
            type="button"
            className="cp-confirm-button"
            aria-pressed={state === decision}
            onClick={() => handleDecision(decision)}
          >
            {CLIENT_CONFIRMATION_LABELS[decision]}
          </button>
        ))}
      </div>
    </div>
  );
}
