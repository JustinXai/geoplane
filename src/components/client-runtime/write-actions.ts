/**
 * CLIENT_WORKSPACE_RUNTIME_V1 (Agent D — batch 2) — pure state-selection logic for a WRITE
 * action's lifecycle.
 *
 * No React import: the selection is a pure function so the submitting / success / error / forbidden
 * transitions can be unit-tested without a DOM renderer (mirrors how F1 tested selectAsyncState).
 * The submit control components delegate their rendering to this selector.
 *
 * The states a client write surfaces: Idle (nothing submitted yet), Submitting (in flight),
 * Success (the command was recorded — the screen then refreshes), Forbidden (UNAUTHENTICATED /
 * FORBIDDEN — a distinct "no permission" affordance) and Error (everything else, e.g. a 422
 * VALIDATION_FAILED or a 500 INTERNAL_ERROR, surfaced with its code + message).
 */
import type { ApiErrorCodeV1 } from "../../runtime/api-contracts/index.js";
import type { Result } from "../../lib/api-client/http.js";

export type WriteStatus = "idle" | "submitting" | "success" | "forbidden" | "error";

export type WriteState =
  | { readonly status: "idle" }
  | { readonly status: "submitting" }
  | { readonly status: "success" }
  | {
      readonly status: "forbidden";
      readonly code: "UNAUTHENTICATED" | "FORBIDDEN";
      readonly message: string;
    }
  | { readonly status: "error"; readonly code: ApiErrorCodeV1; readonly message: string };

export interface SelectWriteStateInput<T> {
  /** True while a submit is in flight. */
  readonly submitting: boolean;
  /** The outcome of the most recent submit, or undefined before anything has been submitted. */
  readonly result: Result<T> | undefined;
}

/** Reduces (submitting flag + last Result) to exactly one of the five write states. */
export function selectWriteState<T>(input: SelectWriteStateInput<T>): WriteState {
  if (input.submitting) return { status: "submitting" };
  if (input.result === undefined) return { status: "idle" };

  if (input.result.ok) return { status: "success" };

  const { code, message } = input.result;
  if (code === "UNAUTHENTICATED" || code === "FORBIDDEN") {
    return { status: "forbidden", code, message };
  }
  return { status: "error", code, message };
}
