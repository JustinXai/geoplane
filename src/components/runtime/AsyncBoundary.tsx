"use client";

/**
 * FRONTEND_API_CLIENT_V1 — reusable React primitives for the five async UI states.
 *
 * Building blocks for LATER page-wiring checkpoints — NOT finished pages. Markup is
 * minimal and reuses existing className conventions observed in src/app (cp-callout,
 * cp-placeholder-note, cp-list-empty). It deliberately does not restyle anything.
 *
 *  - useAsyncData: headless hook that runs a loader and exposes { state, reload }.
 *  - AsyncBoundary: children-as-function component that renders the right state.
 *
 * All state selection is delegated to the pure selectAsyncState (async-state.ts).
 */
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import type { Result } from "../../lib/api-client/http.js";
import { type AsyncState, selectAsyncState } from "./async-state.js";

export type { AsyncState } from "./async-state.js";
export { selectAsyncState, isEmptyList } from "./async-state.js";

// ---------------------------------------------------------------------------
// useAsyncData — headless data hook
// ---------------------------------------------------------------------------

export interface UseAsyncDataResult<T> {
  readonly state: AsyncState<T>;
  /** Re-run the loader (e.g. from a Retry button). */
  readonly reload: () => void;
}

/**
 * Runs `loader` once on mount (and whenever a value in `deps` changes) and reduces its
 * Result to an AsyncState. Stale responses from a superseded load are ignored.
 */
export function useAsyncData<T>(
  loader: () => Promise<Result<T>>,
  options: { readonly isEmpty?: (data: T) => boolean; readonly deps?: readonly unknown[] } = {},
): UseAsyncDataResult<T> {
  const { isEmpty } = options;
  const deps = options.deps ?? [];

  const [result, setResult] = useState<Result<T> | undefined>(undefined);
  const [nonce, setNonce] = useState(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const reload = useCallback(() => {
    setResult(undefined);
    setNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    let active = true;
    setResult(undefined);
    loaderRef.current().then(
      (r) => {
        if (active) setResult(r);
      },
      (thrown) => {
        // Network/parse failures surface as a thrown ApiClientError. Represent them as an
        // INTERNAL_ERROR result so the boundary shows the Error state instead of crashing.
        if (active) {
          setResult({
            ok: false,
            code: "INTERNAL_ERROR",
            message: thrown instanceof Error ? thrown.message : "Request failed",
          });
        }
      },
    );
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce, ...deps]);

  return { state: selectAsyncState({ result, isEmpty }), reload };
}

// ---------------------------------------------------------------------------
// AsyncBoundary — children-as-function renderer
// ---------------------------------------------------------------------------

export interface AsyncBoundaryProps<T> {
  /** The current Result, or undefined while loading. */
  readonly result: Result<T> | undefined;
  readonly isEmpty?: (data: T) => boolean;
  readonly loading?: ReactNode;
  readonly empty?: ReactNode;
  readonly renderError?: (error: { code: string; message: string }) => ReactNode;
  readonly renderForbidden?: (error: { code: string; message: string }) => ReactNode;
  readonly children: (data: T) => ReactNode;
}

/** Renders exactly one of Loading / Empty / Forbidden / Error / Success. */
export function AsyncBoundary<T>(props: AsyncBoundaryProps<T>): ReactNode {
  const state = selectAsyncState({ result: props.result, isEmpty: props.isEmpty });

  switch (state.status) {
    case "loading":
      return props.loading ?? <p className="cp-placeholder-note" role="status" aria-live="polite">加载中…</p>;
    case "empty":
      return props.empty ?? <p className="cp-list-row cp-list-empty">暂无数据</p>;
    case "forbidden":
      return (
        props.renderForbidden?.({ code: state.code, message: state.message }) ?? (
          <p className="cp-callout" role="alert">无访问权限：{state.message}</p>
        )
      );
    case "error":
      return (
        props.renderError?.({ code: state.code, message: state.message }) ?? (
          <p className="cp-callout" role="alert">加载失败：{state.message}</p>
        )
      );
    case "success":
      return props.children(state.data);
  }
}
