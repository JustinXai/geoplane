/**
 * AGENCY_OPS_WORKSPACE_RUNTIME_V1 (batch 2) — renders exactly one of the five async UI states from
 * an AsyncState<T>, for the OPS workspace. A thin mirror of the batch-1 AgencyAsyncView: the pages
 * drive their loads through the frozen `useAsyncData` (which owns retry/stale-guard and exposes a
 * selected AsyncState), so they need a renderer over AsyncState rather than a raw Result. Same
 * five-state contract and same default markup/className conventions — no restyling.
 */
import type { ReactNode } from "react";
import type { AsyncState } from "../runtime/async-state.js";

export interface OpsAsyncViewProps<T> {
  readonly state: AsyncState<T>;
  readonly loading?: ReactNode;
  readonly empty?: ReactNode;
  readonly renderForbidden?: (error: { code: string; message: string }) => ReactNode;
  readonly renderError?: (error: { code: string; message: string }) => ReactNode;
  readonly children: (data: T) => ReactNode;
}

export function OpsAsyncView<T>(props: OpsAsyncViewProps<T>): ReactNode {
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
            当前账号无权访问此页面。
          </p>
        )
      );
    case "error":
      return (
        props.renderError?.({ code: state.code, message: state.message }) ?? (
          <p className="cp-callout" role="alert">
            数据加载失败，请稍后重试。
          </p>
        )
      );
    case "success":
      return <>{props.children(state.data)}</>;
  }
}
