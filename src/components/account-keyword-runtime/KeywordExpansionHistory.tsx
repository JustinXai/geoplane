"use client";

import { useState } from "react";
import type { Result } from "../../lib/api-client/http.js";
import type { KeywordExpansionBatch } from "../../runtime/keyword-expansion/contract.js";
import { useAsyncData } from "../runtime/index.js";
import { ActionFeedback } from "./ActionFeedback.js";
import { accountKeywordApi } from "./api.js";
import { expansionReviewStatusLabel } from "./labels.js";

export function KeywordExpansionHistory({ projectId, questionsOnly = false, refreshKey = 0 }: {
  readonly projectId: string;
  readonly questionsOnly?: boolean;
  readonly refreshKey?: number;
}) {
  const resource = useAsyncData<readonly KeywordExpansionBatch[]>(
    () => accountKeywordApi.listExpansions(projectId),
    { deps: [projectId, refreshKey], isEmpty: (rows) => rows.flatMap((batch) => batch.candidates).filter((item) => !questionsOnly || item.question !== null).length === 0 },
  );
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Result<unknown> | null>(null);

  async function decide(id: string, decision: "CONFIRMED" | "DELETED") {
    setPendingId(id); setFeedback(null);
    try {
      const result = decision === "CONFIRMED"
        ? await accountKeywordApi.confirmExpansion(id, "人工确认符合当前项目范围")
        : await accountKeywordApi.removeExpansion(id, "人工确认不纳入当前项目");
      setFeedback(result);
      if (result.ok) resource.reload();
    } catch {
      setFeedback({ ok: false, code: "INTERNAL_ERROR", message: "网络请求失败" });
    } finally { setPendingId(null); }
  }

  if (resource.state.status === "loading") return <p className="cp-placeholder-note">正在读取已保存记录…</p>;
  if (resource.state.status === "error") return <div className="cp-actions"><p className="cp-placeholder-note">记录读取失败，请稍后重试。</p><button type="button" className="cp-button" onClick={resource.reload}>重新加载</button></div>;
  const rows = resource.state.status === "success"
    ? resource.state.data.flatMap((batch) => batch.candidates).filter((item) => !questionsOnly || item.question !== null)
    : [];
  if (rows.length === 0) return <p className="cp-list-row cp-list-empty">{questionsOnly ? "暂无已保存的用户问题。" : "暂无已保存的扩展结果。"}</p>;
  return <>
    <div className="cp-table-wrap"><table className="cp-data-table"><thead><tr><th>扩展词</th><th>用户问题</th><th>状态</th><th>人工操作</th></tr></thead><tbody>
      {rows.map((item) => <tr key={item.id}><td>{item.keyword}</td><td>{item.question ?? "未填写"}</td><td>{expansionReviewStatusLabel[item.status]}</td><td>
        {item.status === "NEEDS_HUMAN_REVIEW" ? <div className="cp-actions"><button type="button" className="cp-button cp-button-primary" disabled={pendingId !== null} onClick={() => void decide(item.id, "CONFIRMED")}>确认保留</button><button type="button" className="cp-button" disabled={pendingId !== null} onClick={() => void decide(item.id, "DELETED")}>移除</button></div> : "已处理"}
      </td></tr>)}
    </tbody></table></div>
    <ActionFeedback pending={pendingId !== null} result={feedback} successText="人工审核决定已保存。" />
  </>;
}
