/**
 * AGENCY_OPS_WORKSPACE_RUNTIME_V1 (batch 1) — renders exactly one of the five async UI states
 * from an AsyncState<T>.
 *
 * The frozen runtime provides two complementary primitives: `useAsyncData` (owns the load
 * lifecycle, exposes a selected `AsyncState`) and `AsyncBoundary` (renders the five states from a
 * raw `Result`). Pages here use `useAsyncData` for its retry/stale-guard lifecycle, so they need
 * a renderer over `AsyncState` rather than `Result`. This is that thin adapter — same five-state
 * contract and same default markup/className conventions as AsyncBoundary, no restyling.
 */
import type { ReactNode } from "react";
import type { AsyncState } from "../runtime/async-state.js";

export interface AgencyAsyncViewProps<T> {
  readonly state: AsyncState<T>;
  readonly loading?: ReactNode;
  readonly empty?: ReactNode;
  readonly renderForbidden?: (error: { code: string; message: string }) => ReactNode;
  readonly renderError?: (error: { code: string; message: string }) => ReactNode;
  readonly children: (data: T) => ReactNode;
}

export function AgencyAsyncView<T>(props: AgencyAsyncViewProps<T>): ReactNode {
  const state = props.state;
  switch (state.status) {
    case "loading":
      return (
        props.loading ?? (
          <p className="cp-placeholder-note" role="status" aria-live="polite">
            加载中…
          </p>
        )
      );
    case "empty":
      return props.empty ?? <p className="cp-list-row cp-list-empty">暂无数据</p>;
    case "forbidden":
      return (
        props.renderForbidden?.({ code: state.code, message: state.message }) ?? (
          <p className="cp-callout" role="alert">
            无访问权限：{state.message}
          </p>
        )
      );
    case "error":
      return (
        props.renderError?.({ code: state.code, message: state.message }) ?? (
          <p className="cp-callout" role="alert">
            加载失败：{state.message}
          </p>
        )
      );
    case "success":
      return <>{props.children(state.data)}</>;
  }
}
