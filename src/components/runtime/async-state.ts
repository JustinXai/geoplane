/**
 * FRONTEND_API_CLIENT_V1 — pure state-selection logic for the five async UI states.
 *
 * No React import: the selection is a pure function so it can be unit-tested without a
 * DOM renderer. AsyncBoundary.tsx and useAsyncData both delegate to selectAsyncState.
 *
 * The five states the spec requires: Loading, Empty, Error, Forbidden, Success.
 * Forbidden is split out from Error so pages can show a distinct "no access" affordance
 * for UNAUTHENTICATED / FORBIDDEN rather than a generic failure.
 */
import type { ApiErrorCodeV1 } from "../../runtime/api-contracts/index.js";
import type { Result } from "../../lib/api-client/http.js";

export type AsyncStatus = "loading" | "empty" | "error" | "forbidden" | "success";

export type AsyncState<T> =
  | { readonly status: "loading" }
  | { readonly status: "empty" }
  | { readonly status: "forbidden"; readonly code: "UNAUTHENTICATED" | "FORBIDDEN"; readonly message: string }
  | { readonly status: "error"; readonly code: ApiErrorCodeV1; readonly message: string }
  | { readonly status: "success"; readonly data: T };

export interface SelectAsyncStateInput<T> {
  /** undefined while the request is still in flight. */
  readonly result: Result<T> | undefined;
  /** Optional predicate that flags a successful-but-empty payload (e.g. []). */
  readonly isEmpty?: (data: T) => boolean;
}

/** Reduces a Result (or absence of one) to exactly one of the five async states. */
export function selectAsyncState<T>(input: SelectAsyncStateInput<T>): AsyncState<T> {
  const { result, isEmpty } = input;

  if (result === undefined) {
    return { status: "loading" };
  }

  if (!result.ok) {
    if (result.code === "UNAUTHENTICATED" || result.code === "FORBIDDEN") {
      return { status: "forbidden", code: result.code, message: result.message };
    }
    return { status: "error", code: result.code, message: result.message };
  }

  if (isEmpty !== undefined && isEmpty(result.data)) {
    return { status: "empty" };
  }

  return { status: "success", data: result.data };
}

/** Convenience emptiness check for the common PaginatedV1 / array-like shapes. */
export function isEmptyList(value: { readonly items: readonly unknown[] }): boolean {
  return value.items.length === 0;
}
