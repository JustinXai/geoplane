/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * reconstruction_source: docs/architecture/SYSTEM_BLUEPRINT_V1.md (business core items 2
 *   and 3 - client confirmation step for keyword mapping and content/source grounding)
 * reconstruction_reason: no original test source recoverable - see
 *   docs/rebuild/RECOVERY_GAP_ANALYSIS.md ("Test suite - Not recovered as files")
 * original_file_unavailable: true
 *
 * Checkpoint C5 test: the client-confirmation view-model (src/app/app/_confirmation.ts)
 * must stay a true three-state decision (CONFIRMED / CHANGES_REQUESTED / DEFERRED) - not
 * a boolean/two-state approve shortcut - and a freshly-constructed confirmation item must
 * never default to CONFIRMED. No JSX render pipeline is configured in this repo yet, so
 * this follows the plain-string/state-check test style already used by
 * tests/client-workspace-copy.test.ts and tests/agency-acting-banner.test.ts.
 */
import { describe, expect, it } from "vitest";
import {
  CLIENT_CONFIRMATION_DECISIONS,
  CLIENT_CONFIRMATION_LABELS,
  NOT_YET_REVIEWED,
  applyClientConfirmationDecision,
  createInitialConfirmationState,
  type ClientConfirmationDecision,
  type ClientConfirmationState,
} from "../src/app/app/_confirmation.js";

describe("client confirmation three-state model (checkpoint C5)", () => {
  it("exposes exactly three real decisions, all distinct", () => {
    expect(CLIENT_CONFIRMATION_DECISIONS.length).toBe(3);
    const unique = new Set(CLIENT_CONFIRMATION_DECISIONS);
    expect(unique.size).toBe(3);
    expect(unique.has("CONFIRMED")).toBe(true);
    expect(unique.has("CHANGES_REQUESTED")).toBe(true);
    expect(unique.has("DEFERRED")).toBe(true);
  });

  it("has no boolean/two-state shortcut - every decision is a distinct string, never a boolean", () => {
    // If this were secretly a boolean, every decision would collapse to one of two
    // truthy/falsy buckets. Assert all three are non-boolean string values instead.
    for (const decision of CLIENT_CONFIRMATION_DECISIONS) {
      const value: unknown = decision;
      expect(typeof value).toBe("string");
      expect(typeof value).not.toBe("boolean");
    }
    // @ts-expect-error - "APPROVED" is not a valid ClientConfirmationDecision; only the
    // three CONFIRMED/CHANGES_REQUESTED/DEFERRED literals are assignable (a real
    // three-state union, not a boolean/two-state approve shortcut).
    const invalid: ClientConfirmationDecision = "APPROVED";
    void invalid;
  });

  it("the not-yet-reviewed sentinel is distinct from all three real decisions", () => {
    expect(CLIENT_CONFIRMATION_DECISIONS).not.toContain(NOT_YET_REVIEWED);
    const allStates: ClientConfirmationState[] = [...CLIENT_CONFIRMATION_DECISIONS, NOT_YET_REVIEWED];
    expect(new Set(allStates).size).toBe(4);
  });

  it("every state (including the sentinel) has a distinct human-readable label", () => {
    const labels = Object.values(CLIENT_CONFIRMATION_LABELS);
    expect(labels.length).toBe(4);
    expect(new Set(labels).size).toBe(4);
  });

  it("a freshly-constructed confirmation item starts as NOT_YET_REVIEWED, never CONFIRMED", () => {
    const initial = createInitialConfirmationState();
    expect(initial).toBe(NOT_YET_REVIEWED);
    expect(initial).not.toBe("CONFIRMED");
    expect(initial).not.toBe("CHANGES_REQUESTED");
    expect(initial).not.toBe("DEFERRED");
  });

  it("applying an explicit decision transitions away from the not-yet-reviewed sentinel", () => {
    const initial = createInitialConfirmationState();
    for (const decision of CLIENT_CONFIRMATION_DECISIONS) {
      const next = applyClientConfirmationDecision(decision);
      expect(next).toBe(decision);
      expect(next).not.toBe(initial);
    }
  });
});
