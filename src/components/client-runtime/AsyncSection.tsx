"use client";

/**
 * CLIENT_WORKSPACE_RUNTIME_V1 (Agent D) — shared five-state renderer for the CLIENT
 * workspace data sections.
 *
 * Driven by the AsyncState that useAsyncData already reduces a Result to (via the shared
 * pure selectAsyncState). It renders exactly one of Loading / Empty / Forbidden / Error /
 * Success, reusing the same minimal className conventions and default copy as the runtime
 * AsyncBoundary — it deliberately restyles nothing. AsyncBoundary is driven by a raw
 * Result; this sibling is driven by the AsyncState the hook exposes, so pages can wire
 * `useAsyncData` + one render tree without threading the Result back out.
 */
import type { ReactNode } from "react";
import type { AsyncState } from "../runtime/index.js";

export interface AsyncSectionProps<T> {
  readonly state: AsyncState<T>;
  readonly loading?: ReactNode;
  readonly empty?: ReactNode;
  /** Re-run affordance surfaced on the Error state (e.g. useAsyncData's reload). */
  readonly onRetry?: () => void;
  readonly children: (data: T) => ReactNode;
}

/** Renders exactly one of Loading / Empty / Forbidden / Error / Success. */
export function AsyncSection<T>(props: AsyncSectionProps<T>): ReactNode {
  const { state } = props;

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
        <p className="cp-callout" role="alert">
          {state.code === "UNAUTHENTICATED" ? "登录状态已失效，请重新登录。" : "无权访问当前客户或项目的数据。"}
        </p>
      );
    case "error":
      return (
        <p className="cp-callout" role="alert">
          加载失败：{state.code === "NOT_FOUND" ? "未找到对应业务数据。" : state.code === "CONFLICT" ? "数据已发生变化，请刷新后重试。" : state.code === "VALIDATION_FAILED" ? "请求内容不符合要求。" : "系统暂时无法完成请求。"}
          {props.onRetry ? (
            <button type="button" className="cp-confirm-button" onClick={props.onRetry}>
              重试
            </button>
          ) : null}
        </p>
      );
    case "success":
      return props.children(state.data);
  }
}
