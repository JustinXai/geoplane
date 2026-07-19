"use client";

import { BaiduKeywordImportPanel, KeywordExpansionWorkspace } from "../account-keyword-runtime/index.js";
import { useAsyncData } from "../runtime/index.js";
import { getBaiduKeywordOverview } from "../../lib/api-client/domestic.js";
import { ok, type Result } from "../../lib/api-client/http.js";
import type { BaiduKeywordReadModel } from "../../runtime/read-models/domestic-workspaces.js";
import type { ProjectViewV1 } from "../../runtime/api-contracts/index.js";
import { loadProjects } from "./endpoints.js";
import { AsyncSection } from "./AsyncSection.js";

interface KeywordWorkspaceData { readonly project: ProjectViewV1; readonly baidu: BaiduKeywordReadModel }
async function loadWorkspace(): Promise<Result<KeywordWorkspaceData | null>> {
  const projects = await loadProjects(); if (!projects.ok) return projects;
  const project = projects.data[0]; if (!project) return ok(null);
  const baidu = await getBaiduKeywordOverview(project.id);
  if (!baidu.ok) return baidu;
  return ok({ project, baidu: baidu.data });
}

export function ClientKeywordWorkspace() {
  const resource = useAsyncData(loadWorkspace, { isEmpty: (value) => value === null });
  return <AsyncSection state={resource.state} onRetry={resource.reload} empty={<p className="cp-list-row cp-list-empty">暂无可访问项目。</p>}>{(data) => data === null ? null : <div className="cp-stack">
    <section className="cp-card"><h2>百度数据导入</h2><p>当前项目：{data.project.name}</p><BaiduKeywordImportPanel projectId={data.project.id} onImported={resource.reload} /></section>
    <section className="cp-card"><h2>百度真实需求</h2>{data.baidu.keywords.length === 0 ? <p className="cp-list-row cp-list-empty">尚未导入百度关键词。</p> : <div className="cp-table-wrap"><table className="cp-data-table"><thead><tr><th>原始词</th><th>标准化词</th><th>种子来源</th><th>百度需求值</th><th>观察时间</th></tr></thead><tbody>{data.baidu.keywords.map((item) => <tr key={item.id}><td>{item.rawKeyword}</td><td>{item.normalizedKeyword}</td><td>{item.seedKeyword}</td><td>{item.demandEvidence === "OBSERVED_DEMAND" ? (item.demandValue ?? "—") : "无真实数据"}</td><td>{new Date(item.observedAt).toLocaleString("zh-CN")}</td></tr>)}</tbody></table></div>}<p className="cp-placeholder-note">推荐出价、竞争度和地域尚未接入，不显示推测值。</p></section>
    <section className="cp-card"><h2>扩展词与问题整理</h2><KeywordExpansionWorkspace projectId={data.project.id} /><p className="cp-callout">离线扩展结果不代表百度搜索量、出价、竞争度或真实用户需求，必须人工确认后使用。</p></section>
  </div>}</AsyncSection>;
}
