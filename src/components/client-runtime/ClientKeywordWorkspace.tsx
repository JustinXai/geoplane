"use client";

import { useState } from "react";
import { BaiduKeywordImportPanel, KeywordExpansionPanel, expansionReviewStatusLabel } from "../account-keyword-runtime/index.js";
import { ActionFeedback } from "../account-keyword-runtime/ActionFeedback.js";
import { useAsyncData } from "../runtime/index.js";
import { getBaiduKeywordOverview, getKeywordExpansions, reviewKeywordExpansion } from "../../lib/api-client/domestic.js";
import { ok, type Result } from "../../lib/api-client/http.js";
import type { BaiduKeywordReadModel } from "../../runtime/read-models/domestic-workspaces.js";
import type { KeywordExpansionBatch } from "../../runtime/keyword-expansion/contract.js";
import type { ProjectViewV1 } from "../../runtime/api-contracts/index.js";
import { loadProjects } from "./endpoints.js";
import { AsyncSection } from "./AsyncSection.js";

interface KeywordWorkspaceData { readonly project: ProjectViewV1; readonly baidu: BaiduKeywordReadModel; readonly batches: readonly KeywordExpansionBatch[] }
async function loadWorkspace(): Promise<Result<KeywordWorkspaceData | null>> {
  const projects = await loadProjects(); if (!projects.ok) return projects;
  const project = projects.data[0]; if (!project) return ok(null);
  const [baidu, batches] = await Promise.all([getBaiduKeywordOverview(project.id), getKeywordExpansions(project.id)]);
  if (!baidu.ok) return baidu; if (!batches.ok) return batches;
  return ok({ project, baidu: baidu.data, batches: batches.data });
}

export function ClientKeywordWorkspace() {
  const resource = useAsyncData(loadWorkspace, { isEmpty: (value) => value === null });
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [decision, setDecision] = useState<Result<unknown> | null>(null);
  async function review(id: string, next: "CONFIRMED" | "DELETED") {
    setPendingId(id); setDecision(null);
    try { const result = await reviewKeywordExpansion(id, next, next === "CONFIRMED" ? "客户人工确认保留" : "客户人工确认移除"); setDecision(result); if (result.ok) resource.reload(); }
    catch { setDecision({ ok: false, code: "INTERNAL_ERROR", message: "网络请求失败" }); }
    finally { setPendingId(null); }
  }
  return <AsyncSection state={resource.state} onRetry={resource.reload} empty={<p className="cp-list-row cp-list-empty">暂无可访问项目。</p>}>{(data) => data === null ? null : <div className="cp-stack">
    <section className="cp-card"><h2>百度数据导入</h2><p>当前项目：{data.project.name}</p><BaiduKeywordImportPanel projectId={data.project.id} snapshotVersion={(data.baidu.imports[0]?.snapshotVersion ?? 0) + 1} onImported={resource.reload} /></section>
    <section className="cp-card"><h2>百度真实需求</h2>{data.baidu.keywords.length === 0 ? <p className="cp-list-row cp-list-empty">尚未导入百度关键词。</p> : <div className="cp-table-wrap"><table className="cp-data-table"><thead><tr><th>原始词</th><th>标准化词</th><th>种子来源</th><th>百度需求值</th><th>观察时间</th></tr></thead><tbody>{data.baidu.keywords.map((item) => <tr key={item.id}><td>{item.rawKeyword}</td><td>{item.normalizedKeyword}</td><td>{item.seedKeyword}</td><td>{item.demandEvidence === "OBSERVED_DEMAND" ? (item.demandValue ?? "—") : "无真实数据"}</td><td>{new Date(item.observedAt).toLocaleString("zh-CN")}</td></tr>)}</tbody></table></div>}<p className="cp-placeholder-note">推荐出价、竞争度和地域尚未接入，不显示推测值。</p></section>
    <section className="cp-card"><h2>AI 拓词</h2><KeywordExpansionPanel projectId={data.project.id} /><h3>已保存的人工审核结果</h3>{data.batches.flatMap((batch) => batch.candidates).length === 0 ? <p className="cp-list-row cp-list-empty">暂无已保存扩展结果。</p> : <div className="cp-table-wrap"><table className="cp-data-table"><thead><tr><th>扩展词</th><th>用户问题</th><th>状态</th><th>人工操作</th></tr></thead><tbody>{data.batches.flatMap((batch) => batch.candidates).map((item) => <tr key={item.id}><td>{item.keyword}</td><td>{item.question ?? "—"}</td><td>{expansionReviewStatusLabel[item.status]}</td><td>{item.status === "NEEDS_HUMAN_REVIEW" ? <div className="cp-actions"><button type="button" className="cp-button cp-button-primary" disabled={pendingId !== null} onClick={() => void review(item.id, "CONFIRMED")}>确认保留</button><button type="button" className="cp-button" disabled={pendingId !== null} onClick={() => void review(item.id, "DELETED")}>移除</button></div> : "已处理"}</td></tr>)}</tbody></table></div>}<ActionFeedback pending={pendingId !== null} result={decision} successText="人工审核决定已保存。" /><p className="cp-callout">AI 扩展结果不代表百度搜索量、出价、竞争度或真实用户需求，必须人工确认后使用。</p></section>
  </div>}</AsyncSection>;
}
