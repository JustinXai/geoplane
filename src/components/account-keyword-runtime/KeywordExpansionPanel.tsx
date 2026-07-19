"use client";

import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import type { Result } from "../../lib/api-client/http.js";
import type { ExpansionGroupType, KeywordExpansionBatch, KeywordExpansionCandidate } from "../../runtime/keyword-expansion/contract.js";
import { accountKeywordApi } from "./api.js";
import { ActionFeedback } from "./ActionFeedback.js";
import { expansionGroupLabel, expansionReviewStatusLabel } from "./labels.js";

const groupTypes: readonly ExpansionGroupType[] = ["PREFIX", "MAIN", "SUFFIX", "RECOMMENDATION", "QUESTION", "REGION"];
const splitValues = (value: string) => value.split(/[\n,，]/).map((item) => item.trim()).filter(Boolean);

export function KeywordExpansionPanel({ projectId, onSaved }: { readonly projectId: string; readonly onSaved?: () => void }): ReactNode {
  const [inputs, setInputs] = useState<Record<ExpansionGroupType, string>>({ PREFIX: "", MAIN: "", SUFFIX: "", RECOMMENDATION: "", QUESTION: "", REGION: "" });
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<Result<KeywordExpansionBatch> | null>(null);
  const [batch, setBatch] = useState<KeywordExpansionBatch | null>(null);
  const groups = useMemo(() => groupTypes.map((type) => ({ type, values: splitValues(inputs[type]) })).filter((group) => group.values.length > 0), [inputs]);

  async function preview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reason.trim() || groups.length === 0) return;
    setPending(true);
    setResult(null);
    try {
      const response = await accountKeywordApi.previewExpansion({ projectId, reason: reason.trim(), groups });
      setResult(response);
      if (response.ok) { setBatch(response.data); onSaved?.(); }
    } catch {
      setResult({ ok: false, code: "INTERNAL_ERROR", message: "网络请求失败" });
    } finally {
      setPending(false);
    }
  }

  async function decide(candidate: KeywordExpansionCandidate, decision: "confirm" | "remove") {
    setPending(true); setResult(null);
    try {
      const response = decision === "confirm"
        ? await accountKeywordApi.confirmExpansion(candidate.id, "人工确认用于后续问题整理")
        : await accountKeywordApi.removeExpansion(candidate.id, "人工判断不适合当前项目");
      if (response.ok && batch) { setBatch({ ...batch, candidates: batch.candidates.map((item) => item.id === candidate.id ? response.data : item) }); onSaved?.(); }
      else setResult(response as Result<KeywordExpansionBatch>);
    } catch {
      setResult({ ok: false, code: "INTERNAL_ERROR", message: "网络请求失败" });
    } finally { setPending(false); }
  }

  return (
    <div>
      <form className="cp-form" onSubmit={preview}>
        <div className="cp-form-grid">
          {groupTypes.map((type) => (
            <label key={type}>{expansionGroupLabel[type]}
              <textarea rows={2} value={inputs[type]} onChange={(event) => setInputs((current) => ({ ...current, [type]: event.target.value }))} placeholder="每行一个词，也可用逗号分隔" disabled={pending} />
            </label>
          ))}
        </div>
        <label>本次扩展用途
          <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="说明为什么需要整理这批候选词" maxLength={300} required disabled={pending} />
        </label>
        <p className="cp-placeholder-note">本功能使用确定性离线组合，不调用真实模型，也不代表搜索量、排名或真实用户需求。所有结果必须逐条人工确认。</p>
        <button className="cp-button cp-button-primary" type="submit" disabled={pending || groups.length === 0 || !reason.trim()}>生成预览</button>
        <ActionFeedback pending={pending} result={result} successText="预览已生成，请逐条人工确认。" />
      </form>
      {batch && batch.candidates.length === 0 ? <p className="cp-list-row cp-list-empty">本次没有生成可审核的候选词，请调整输入后重试。</p> : null}
      {batch && batch.candidates.length > 0 ? (
        <div className="cp-table-wrap">
          <table className="cp-data-table">
            <thead><tr><th>候选关键词</th><th>用户问题</th><th>生成说明</th><th>状态</th><th>人工操作</th></tr></thead>
            <tbody>{batch.candidates.map((candidate) => (
              <tr key={candidate.id}>
                <td>{candidate.keyword}</td><td>{candidate.question ?? "—"}</td><td>{candidate.reason}</td><td>{expansionReviewStatusLabel[candidate.status]}</td>
                <td>{candidate.status === "NEEDS_HUMAN_REVIEW" ? <div className="cp-actions"><button type="button" className="cp-button cp-button-primary" disabled={pending} onClick={() => void decide(candidate, "confirm")}>确认保留</button><button type="button" className="cp-button" disabled={pending} onClick={() => void decide(candidate, "remove")}>移除</button></div> : "已处理"}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
