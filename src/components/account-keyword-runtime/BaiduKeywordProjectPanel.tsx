"use client";

import { useMemo, useState, type ReactNode } from "react";
import { getBaiduKeywordOverview } from "../../lib/api-client/domestic.js";
import { statusText } from "../../lib/i18n/zh-CN.js";
import type { BaiduKeywordReadModel } from "../../runtime/read-models/domestic-workspaces.js";
import { useAsyncData } from "../runtime/index.js";
import { BaiduKeywordImportPanel } from "./BaiduKeywordImportPanel.js";
import { BaiduKeywordReviewPanel } from "./BaiduKeywordReviewPanel.js";

type DemandFilter = "ALL" | "OBSERVED" | "MISSING";

function KeywordOverview({ data }: { readonly data: BaiduKeywordReadModel }): ReactNode {
  const [search, setSearch] = useState("");
  const [demandFilter, setDemandFilter] = useState<DemandFilter>("ALL");
  const [importId, setImportId] = useState("ALL");
  const rows = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("zh-CN");
    return data.keywords.filter((item) => {
      if (importId !== "ALL" && item.importId !== importId) return false;
      if (demandFilter === "OBSERVED" && item.demandEvidence !== "OBSERVED_DEMAND") return false;
      if (demandFilter === "MISSING" && item.demandEvidence === "OBSERVED_DEMAND") return false;
      return !term || [item.rawKeyword, item.normalizedKeyword, item.seedKeyword].some((value) => value.toLocaleLowerCase("zh-CN").includes(term));
    });
  }, [data.keywords, demandFilter, importId, search]);

  return <div className="cp-stack">
    <section className="cp-section">
      <h2>关键词数据概览</h2>
      <div className="cp-metric-grid">
        <div className="cp-card"><p className="cp-card-value">{data.totals.imports}</p><p className="cp-card-label">导入批次</p></div>
        <div className="cp-card"><p className="cp-card-value">{data.totals.keywords}</p><p className="cp-card-label">关键词记录</p></div>
        <div className="cp-card"><p className="cp-card-value">{data.totals.withObservedDemand}</p><p className="cp-card-label">含百度需求值</p></div>
        <div className="cp-card"><p className="cp-card-value">{data.totals.rejectedRows}</p><p className="cp-card-label">未接收行</p></div>
      </div>
    </section>
    <section className="cp-section">
      <h2>导入记录</h2>
      {data.imports.length === 0 ? <p className="cp-list-row cp-list-empty">尚未导入百度关键词文件。请下载百度侧数据后，在下方选择 CSV 或 XLSX 文件导入。</p> :
        <div className="cp-table-wrap"><table className="cp-data-table"><thead><tr><th>文件</th><th>格式</th><th>状态</th><th>有效记录</th><th>未接收</th><th>数据版本</th><th>完成时间</th></tr></thead><tbody>{data.imports.map((item) => <tr key={item.id}><td>{item.fileName}</td><td>{item.format}</td><td>{statusText(item.status)}</td><td>{item.parsedCount}</td><td>{item.rejectedCount}</td><td>{item.snapshotVersion === null ? "—" : `第 ${item.snapshotVersion} 版`}</td><td>{item.sealedAt ? new Date(item.sealedAt).toLocaleString("zh-CN") : "—"}</td></tr>)}</tbody></table></div>}
    </section>
    <section className="cp-section">
      <h2>关键词列表</h2>
      <div className="cp-actions">
        <label className="cp-field"><span className="cp-field-label">搜索关键词</span><input className="cp-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索原始词、标准化词或种子词" /></label>
        <label className="cp-field"><span className="cp-field-label">需求数据</span><select className="cp-input" value={demandFilter} onChange={(event) => setDemandFilter(event.target.value as DemandFilter)}><option value="ALL">全部</option><option value="OBSERVED">有真实需求值</option><option value="MISSING">无真实需求值</option></select></label>
        <label className="cp-field"><span className="cp-field-label">导入批次</span><select className="cp-input" value={importId} onChange={(event) => setImportId(event.target.value)}><option value="ALL">全部批次</option>{data.imports.map((item) => <option key={item.id} value={item.id}>{item.fileName} · {item.snapshotVersion === null ? "未形成版本" : `第 ${item.snapshotVersion} 版`}</option>)}</select></label>
      </div>
      {data.keywords.length === 0 ? <p className="cp-list-row cp-list-empty">当前项目暂无关键词记录。完成首次文件导入后，关键词会显示在这里。</p> : rows.length === 0 ? <p className="cp-list-row cp-list-empty">没有符合当前筛选条件的关键词。请清除搜索词或调整筛选条件。</p> :
        <div className="cp-table-wrap"><table className="cp-data-table"><thead><tr><th>原始词</th><th>标准化词</th><th>种子词</th><th>数据状态</th><th>百度需求值</th><th>观察时间</th></tr></thead><tbody>{rows.map((item) => <tr key={item.id}><td>{item.rawKeyword}</td><td>{item.normalizedKeyword}</td><td>{item.seedKeyword}</td><td>{item.demandEvidence === "OBSERVED_DEMAND" ? "含真实需求值" : "仅关键词记录"}</td><td>{item.demandEvidence === "OBSERVED_DEMAND" ? (item.demandValue ?? "—") : "无真实数据"}</td><td>{new Date(item.observedAt).toLocaleString("zh-CN")}</td></tr>)}</tbody></table></div>}
      <p className="cp-placeholder-note">只展示已入库的真实记录。百度推荐出价、竞争度和地域维度尚未接入，因此不显示推测值。</p>
    </section>
  </div>;
}

export function BaiduKeywordProjectPanel({ projectId }: { readonly projectId: string }): ReactNode {
  const resource = useAsyncData<BaiduKeywordReadModel>(() => getBaiduKeywordOverview(projectId), { deps: [projectId] });
  return <div className="cp-stack">
    {resource.state.status === "loading" ? <section className="cp-section" role="status"><p>正在读取关键词数据…</p></section> : null}
    {resource.state.status === "forbidden" ? <section className="cp-section" role="alert"><h2>无法访问该项目</h2><p>当前账号没有查看该项目关键词的权限。</p></section> : null}
    {resource.state.status === "error" ? <section className="cp-section" role="alert"><h2>关键词数据加载失败</h2><p>{resource.state.message}</p><button className="cp-button" type="button" onClick={resource.reload}>重新加载</button></section> : null}
    {resource.state.status === "success" ? <><KeywordOverview data={resource.state.data} /><BaiduKeywordReviewPanel projectId={projectId} data={resource.state.data} onChanged={resource.reload}/></> : null}
    <section className="cp-section"><h2>导入百度关键词文件</h2><BaiduKeywordImportPanel projectId={projectId} onImported={resource.reload} /></section>
  </div>;
}
