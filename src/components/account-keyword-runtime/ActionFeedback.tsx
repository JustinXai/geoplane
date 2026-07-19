import type { ReactNode } from "react";
import type { Result } from "../../lib/api-client/http.js";
import { accountKeywordErrorMessage } from "./labels.js";

export function ActionFeedback({ pending, result, successText }: {
  readonly pending: boolean;
  readonly result: Result<unknown> | null;
  readonly successText: string;
}): ReactNode {
  if (pending) return <p className="cp-placeholder-note" role="status">正在提交，请稍候…</p>;
  if (!result) return null;
  if (result.ok) return <p className="cp-placeholder-note" role="status">{successText}</p>;
  return (
    <p className="cp-callout" role="alert">
      {result.code === "FORBIDDEN" ? "无操作权限：" : "操作未完成："}
      {accountKeywordErrorMessage(result.code, result.message)}
    </p>
  );
}
