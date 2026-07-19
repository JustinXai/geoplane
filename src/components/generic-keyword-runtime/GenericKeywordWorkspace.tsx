"use client";

import Link from "next/link";
import { useState, type FormEvent, type ReactNode } from "react";
import { useAsyncData } from "../runtime/index.js";
import { createGenericKeywordApi, type DemandEvidenceView, type GenericKeywordApi, type GenericKeywordWorkspaceView, type KeywordSource } from "../../lib/api-client/generic-keywords/index.js";
import { fileToBase64 } from "../account-keyword-runtime/api.js";
import { keywordSourceText, provided } from "./display.js";

const defaultApi = createGenericKeywordApi();
type SourceFilter = "ALL" | KeywordSource;

function Evidence({ items }: { readonly items: readonly DemandEvidenceView[] }): ReactNode {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return <span>未提供</span>;
  return <div><button className="cp-button cp-button-secondary" type="button" onClick={() => setOpen((value) => !value)}>{open ? "收起" : `查看 ${items.length} 项`}</button>{open ? <div className="cp-stack">{items.map((item) => <div className="cp-placeholder-note" key={item.id}><strong>{item.metricKind}：{item.metricValue}{item.metricUnit ?? ""}</strong><br />来源：{keywordSourceText[item.source]} · 地域：{provided(item.region)} · 数据期间：{provided(item.periodStart)} 至 {provided(item.periodEnd)}<br />观察时间：{new Date(item.observedAt).toLocaleString("zh-CN")}</div>)}</div> : null}</div>;
}

export function GenericKeywordWorkspace({ projectId, questionsHref, api = defaultApi }: { readonly projectId: string; readonly questionsHref: string; readonly api?: GenericKeywordApi }): ReactNode {
  const resource = useAsyncData(() => api.loadWorkspace(projectId), { deps: [projectId] });
  const [source, setSource] = useState<SourceFilter>("ALL");
  const [datasetId, setDatasetId] = useState("ALL");
  const [batchId, setBatchId] = useState("ALL");
  const [search, setSearch] = useState("");
  const [keyword, setKeyword] = useState("");
  const [datasetName, setDatasetName] = useState("");
  const [newDatasetSource, setNewDatasetSource] = useState<KeywordSource>("MANUAL");
  const [note, setNote] = useState("");
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [file, setFile] = useState<File | null>(null);
  const [importSource, setImportSource] = useState<"GENERIC_FILE" | "BAIDU_KEYWORD">("GENERIC_FILE");
  const [importDatasetId, setImportDatasetId] = useState("");
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState("");

  async function manual(event: FormEvent, selectedDataset: string) {
    event.preventDefault(); setPending(true); setFeedback("");
    const result = await api.addManualKeyword({ projectId, datasetId: selectedDataset, keyword: keyword.trim(), ...(note.trim() ? { note: note.trim() } : {}) });
    setPending(false); setFeedback(result.ok ? "关键词已保存。" : result.message); if (result.ok) { setKeyword(""); setNote(""); resource.reload(); }
  }
  async function createDataset(event: FormEvent) {
    event.preventDefault(); setPending(true); setFeedback("");
    const result = await api.createDataset({ projectId, name: datasetName.trim(), source: newDatasetSource });
    setPending(false); setFeedback(result.ok ? "数据集已创建。" : result.message); if (result.ok) { setDatasetName(""); resource.reload(); }
  }
  async function upload(event: FormEvent, selectedDataset: string) {
    event.preventDefault(); if (!file) return; setPending(true); setFeedback("");
    const result = await api.importFile({ projectId, datasetId: selectedDataset, source: importSource, fileName: file.name, base64: await fileToBase64(file) });
    setPending(false); setFeedback(result.ok ? "文件已导入。" : result.message); if (result.ok) { setFile(null); resource.reload(); }
  }
  async function decide(recordId: string, recordDatasetId: string, decision: "CONFIRMED" | "REJECTED", currentData: GenericKeywordWorkspaceView) {
    setPending(true); setFeedback("");
    const existing = currentData.reviewPackages.find((item) => item.status === "OPEN" && item.keywordRecordIds.includes(recordId));
    const packageResult = existing ? { ok: true as const, data: existing } : await api.createReviewPackage({ projectId, datasetId: recordDatasetId, keywordRecordIds: [recordId], version: Math.max(0, ...currentData.reviewPackages.map((item) => item.version)) + 1 });
    if (!packageResult.ok) { setPending(false); setFeedback(packageResult.message); return; }
    const reviewNote = reviewNotes[recordId]?.trim();
    const result = await api.decide({ projectId, reviewPackageId: packageResult.data.id, keywordRecordId: recordId, decision, ...(reviewNote ? { note: reviewNote } : {}) });
    setPending(false); setFeedback(result.ok ? "人工决定已保存。" : result.message); if (result.ok) resource.reload();
  }
  async function archiveDataset(targetDatasetId: string) {
    setPending(true); setFeedback(""); const result = await api.archiveDataset({ projectId, datasetId: targetDatasetId });
    setPending(false); setFeedback(result.ok ? "数据集已归档。" : result.message); if (result.ok) resource.reload();
  }

  if (resource.state.status === "loading") return <section className="cp-section" role="status">正在读取关键词与需求数据…</section>;
  if (resource.state.status === "empty") return <section className="cp-section"><p className="cp-list-row cp-list-empty">当前项目暂无关键词数据。关键词资料完全可选，可直接基于企业知识生成用户问题。</p><Link className="cp-button cp-button-primary" href={questionsHref}>基于企业知识生成用户问题</Link></section>;
  if (resource.state.status === "forbidden") return <section className="cp-section" role="alert"><h2>无法访问该项目</h2><p>当前账号没有查看该项目关键词数据的权限。</p></section>;
  if (resource.state.status === "error") return <section className="cp-section" role="alert"><h2>关键词数据暂时无法读取</h2><p>{resource.state.message}</p><button className="cp-button" type="button" onClick={resource.reload}>重新加载</button></section>;
  const data = resource.state.data;
  const writableManualDatasets = data.datasets.filter((item) => item.status === "ACTIVE" && !item.readOnly && item.source === "MANUAL");
  const selectedDataset = writableManualDatasets.some((item) => item.id === datasetId) ? datasetId : writableManualDatasets[0]?.id;
  const writableImportDatasets = data.datasets.filter((item) => item.status === "ACTIVE" && !item.readOnly && item.source === importSource);
  const selectedImportDataset = writableImportDatasets.some((item) => item.id === importDatasetId) ? importDatasetId : writableImportDatasets[0]?.id;
  const rows = data.records.filter((row) => (source === "ALL" || row.source === source) && (datasetId === "ALL" || row.datasetId === datasetId) && (batchId === "ALL" || row.importBatchId === batchId) && (!search.trim() || row.keyword.toLocaleLowerCase("zh-CN").includes(search.trim().toLocaleLowerCase("zh-CN"))));
  const evidenceFor = (recordId: string) => data.evidence.filter((item) => item.keywordRecordId === recordId);
  const latestDecision = (recordId: string) => data.decisions.filter((item) => item.keywordRecordId === recordId).sort((a, b) => b.decidedAt.localeCompare(a.decidedAt))[0]?.decision;

  return <div className="cp-stack">
    <section className="cp-section"><h2>关键词与需求数据</h2><p className="cp-placeholder-note">关键词数据是可选资料。没有关键词数据时，仍可基于企业知识生成用户问题；只有来源真实提供的指标才会作为需求证据。</p>{data.records.length === 0 ? <div className="cp-stack"><p className="cp-list-row cp-list-empty">当前项目暂无关键词数据。你可以直接从企业知识开始，也可以补充真实关键词资料。</p><div className="cp-actions"><Link className="cp-button cp-button-primary" href={questionsHref}>基于企业知识生成用户问题</Link><a className="cp-button" href="#keyword-input">导入或手动添加关键词</a></div></div> : null}
      <div className="cp-actions"><label className="cp-field"><span className="cp-field-label">搜索</span><input className="cp-input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索关键词" /></label><label className="cp-field"><span className="cp-field-label">来源</span><select className="cp-input" value={source} onChange={(e) => setSource(e.target.value as SourceFilter)}><option value="ALL">全部来源</option>{Object.entries(keywordSourceText).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="cp-field"><span className="cp-field-label">数据集</span><select className="cp-input" value={datasetId} onChange={(e) => setDatasetId(e.target.value)}><option value="ALL">全部数据集</option>{data.datasets.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="cp-field"><span className="cp-field-label">导入批次</span><select className="cp-input" value={batchId} onChange={(e) => setBatchId(e.target.value)}><option value="ALL">全部批次</option>{data.imports.map((item) => <option key={item.id} value={item.id}>{item.fileName} · {new Date(item.importedAt).toLocaleDateString("zh-CN")}</option>)}</select></label></div>
      {data.records.length > 0 && rows.length === 0 ? <p className="cp-list-row cp-list-empty">没有符合当前筛选条件的数据。</p> : rows.length > 0 ? <div className="cp-table-wrap"><table className="cp-data-table"><thead><tr><th>关键词</th><th>来源</th><th>分类</th><th>地域</th><th>数据期间</th><th>需求证据</th><th>人工状态</th><th>处理说明</th><th>操作</th></tr></thead><tbody>{rows.map((row) => { const decision = latestDecision(row.id); const readOnly = data.datasets.find((item) => item.id === row.datasetId)?.readOnly === true; return <tr key={row.id}><td>{row.keyword}</td><td>{keywordSourceText[row.source]}</td><td>{provided(row.category)}</td><td>{provided(row.region)}</td><td>{provided(row.periodStart)} 至 {provided(row.periodEnd)}</td><td><Evidence items={evidenceFor(row.id)} /></td><td>{readOnly ? "历史数据（只读）" : decision === "CONFIRMED" ? "已确认" : decision === "REJECTED" ? "已拒绝" : decision === "CHANGES_REQUESTED" ? "需要修改" : "待确认"}</td><td><input className="cp-input" aria-label={`处理说明 ${row.keyword}`} disabled={readOnly} value={reviewNotes[row.id] ?? ""} onChange={(event) => setReviewNotes((current) => ({ ...current, [row.id]: event.target.value }))} placeholder="拒绝时必填" /></td><td><div className="cp-actions"><button className="cp-button cp-button-primary" type="button" disabled={pending || readOnly || !data.capabilities.humanReview} onClick={() => decide(row.id, row.datasetId, "CONFIRMED", data)}>确认</button><button className="cp-button" type="button" disabled={pending || readOnly || !data.capabilities.humanReview || !reviewNotes[row.id]?.trim()} onClick={() => decide(row.id, row.datasetId, "REJECTED", data)}>拒绝</button></div></td></tr>; })}</tbody></table></div> : null}
    </section>
    <section className="cp-section"><h2>数据集</h2>{data.datasets.length === 0 ? <p className="cp-list-row cp-list-empty">尚无关键词数据集。</p> : <div className="cp-stack">{data.datasets.map((item) => <article className="cp-card" key={item.id}><div className="cp-card-head"><div><h3>{item.name}</h3><p>{keywordSourceText[item.source]} · {item.readOnly ? "历史数据（只读）" : item.status === "ACTIVE" ? "使用中" : "已归档"}</p></div>{item.status === "ACTIVE" && !item.readOnly ? <button className="cp-button" type="button" disabled={pending || !data.capabilities.archive} onClick={() => archiveDataset(item.id)}>归档数据集</button> : null}</div></article>)}</div>}<form className="cp-form" onSubmit={createDataset}><h3>新建数据集</h3><label><span className="cp-field-label">数据集名称</span><input className="cp-input" required value={datasetName} onChange={(event) => setDatasetName(event.target.value)} /></label><label><span className="cp-field-label">来源类型</span><select className="cp-input" value={newDatasetSource} onChange={(event) => setNewDatasetSource(event.target.value as KeywordSource)}>{Object.entries(keywordSourceText).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><button className="cp-button cp-button-primary" disabled={pending || !data.capabilities.createDataset}>创建数据集</button></form></section>
    <section className="cp-section"><h2>导入批次</h2>{data.imports.length === 0 ? <p className="cp-list-row cp-list-empty">尚无文件导入批次。</p> : <div className="cp-table-wrap"><table className="cp-data-table"><thead><tr><th>文件</th><th>来源</th><th>状态</th><th>导入记录</th><th>未接收</th><th>导入时间</th></tr></thead><tbody>{data.imports.map((item) => <tr key={item.id}><td>{item.fileName}</td><td>{keywordSourceText[item.source]}</td><td>{item.status === "COMPLETED" ? "已完成" : "失败"}</td><td>{item.acceptedCount}</td><td>{item.rejectedCount}</td><td>{new Date(item.importedAt).toLocaleString("zh-CN")}</td></tr>)}</tbody></table></div>}</section>
    <section className="cp-section" id="keyword-input"><h2>补充关键词资料</h2><div className="cp-stack">{selectedDataset ? <form className="cp-form" onSubmit={(event) => manual(event, selectedDataset)}><h3>手动添加</h3><label><span className="cp-field-label">写入数据集</span><select className="cp-input" value={selectedDataset} onChange={(event) => setDatasetId(event.target.value)}>{writableManualDatasets.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label><span className="cp-field-label">关键词</span><input className="cp-input" required value={keyword} onChange={(event) => setKeyword(event.target.value)} /></label><label><span className="cp-field-label">备注（可选）</span><input className="cp-input" value={note} onChange={(event) => setNote(event.target.value)} /></label><button className="cp-button cp-button-primary" disabled={pending || !data.capabilities.manualAdd}>保存关键词</button></form> : <p className="cp-list-row cp-list-empty">手动添加前，请先在上方创建“手动添加”来源的数据集。</p>}<form className="cp-form" onSubmit={(event) => selectedImportDataset ? upload(event, selectedImportDataset) : event.preventDefault()}><h3>导入 CSV / XLSX</h3><label><span className="cp-field-label">文件来源</span><select className="cp-input" value={importSource} onChange={(event) => { setImportSource(event.target.value as typeof importSource); setImportDatasetId(""); }}><option value="GENERIC_FILE">通用关键词文件</option><option value="BAIDU_KEYWORD">百度关键词兼容导入</option></select></label>{selectedImportDataset ? <label><span className="cp-field-label">写入数据集</span><select className="cp-input" value={selectedImportDataset} onChange={(event) => setImportDatasetId(event.target.value)}>{writableImportDatasets.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label> : <p className="cp-list-row cp-list-empty">导入前，请先在上方创建与文件来源一致的数据集。</p>}<input className="cp-input" type="file" accept=".csv,.xlsx" required onChange={(event) => setFile(event.target.files?.[0] ?? null)} /><button className="cp-button cp-button-primary" disabled={pending || !file || !selectedImportDataset || !data.capabilities.genericCsvXlsxImport}>导入文件</button></form></div>{!data.capabilities.manualAdd || !data.capabilities.genericCsvXlsxImport || !data.capabilities.humanReview ? <p className="cp-callout">部分操作当前不可用；对应按钮保持禁用，不会显示虚假的保存结果。</p> : null}{feedback ? <p role="status" className="cp-callout">{feedback}</p> : null}<p className="cp-placeholder-note">搜索量、竞价、竞争度和地域不是必填字段；缺失值显示“未提供”，不会填成 0。</p></section>
  </div>;
}
