"use client";

/**
 * CLIENT_WORKSPACE_RUNTIME_V1 (Agent D — batch 2) — thin React glue for a client WRITE action.
 *
 *  - useWriteAction: headless hook that runs a command wrapper and exposes { state, submit, reset }.
 *    All state selection is delegated to the pure selectWriteState (write-actions.ts); this file
 *    holds no branching logic of its own (mirrors how useAsyncData delegates to selectAsyncState).
 *    A thrown ApiClientError (network / parse failure) is represented as an INTERNAL_ERROR result so
 *    the control shows the Error state instead of crashing — the same mapping useAsyncData uses.
 *  - WriteActionFeedback: renders the submitting / success / forbidden / error line, reusing the
 *    existing className conventions (cp-callout, cp-placeholder-note). It restyles nothing.
 */
import { type ReactNode, useCallback, useRef, useState } from "react";
import type { Result } from "../../lib/api-client/http.js";
import { type WriteState, selectWriteState } from "./write-actions.js";

export type { WriteState } from "./write-actions.js";

export interface UseWriteActionResult<A extends readonly unknown[]> {
  readonly state: WriteState;
  /** Fire the command with its arguments. Ignored while a submit is already in flight. */
  readonly submit: (...args: A) => void;
  /** Return to the idle state (e.g. to dismiss a success / error line). */
  readonly reset: () => void;
}

/**
 * Runs `action` on demand and reduces its Result to a WriteState. On success, `onSuccess` is invoked
 * with the returned data (used to refresh the surrounding list). Concurrent submits are ignored.
 */
export function useWriteAction<A extends readonly unknown[], T>(
  action: (...args: A) => Promise<Result<T>>,
  onSuccess?: (data: T) => void,
): UseWriteActionResult<A> {
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<Result<T> | undefined>(undefined);

  const actionRef = useRef(action);
  actionRef.current = action;
  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;
  const inFlight = useRef(false);

  const submit = useCallback((...args: A) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setResult(undefined);
    actionRef.current(...args).then(
      (r) => {
        inFlight.current = false;
        setSubmitting(false);
        setResult(r);
        if (r.ok) onSuccessRef.current?.(r.data);
      },
      (thrown: unknown) => {
        inFlight.current = false;
        setSubmitting(false);
        setResult({
          ok: false,
          code: "INTERNAL_ERROR",
          message: thrown instanceof Error ? thrown.message : "Request failed",
        });
      },
    );
  }, []);

  const reset = useCallback(() => {
    inFlight.current = false;
    setSubmitting(false);
    setResult(undefined);
  }, []);

  return { state: selectWriteState({ submitting, result }), submit, reset };
}

export interface WriteActionFeedbackProps {
  readonly state: WriteState;
  /** Copy for the success line (defaults to a neutral confirmation). */
  readonly successLabel?: ReactNode;
}

/** Renders the submitting / success / forbidden / error feedback line for a write action (idle → nothing). */
export function WriteActionFeedback({ state, successLabel }: WriteActionFeedbackProps): ReactNode {
  switch (state.status) {
    case "idle":
      return null;
    case "submitting":
      return (
        <p className="cp-placeholder-note" role="status" aria-live="polite">
          提交中…
        </p>
      );
    case "success":
      return (
        <p className="cp-placeholder-note" role="status" aria-live="polite">
          {successLabel ?? "已提交。"}
        </p>
      );
    case "forbidden":
      return (
        <p className="cp-callout" role="alert">
          {state.code === "UNAUTHENTICATED" ? "登录状态已失效，请重新登录。" : "无权对当前客户或项目执行此操作。"}
        </p>
      );
    case "error":
      return (
        <p className="cp-callout" role="alert">
          提交失败：{state.code === "CONFLICT" ? "数据已发生变化，请刷新后重试。" : state.code === "VALIDATION_FAILED" ? "提交内容不符合要求，请检查后重试。" : "系统暂时无法完成请求。"}
        </p>
      );
  }
}
