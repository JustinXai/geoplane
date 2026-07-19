"use client";
import { useState } from "react";
import { useAsyncData } from "../runtime/index.js";
import { OpsAsyncView } from "../ops-runtime/OpsAsyncView.js";
import { OpsPageHeader, opsPageStyles } from "../ops-runtime/OpsPage.js";
import { loadPlatformDirectory, type PlatformDirectoryReadModel } from "../ops-runtime/platform-read-model.js";
import { GenericKeywordWorkspace } from "./GenericKeywordWorkspace.js";

export function OpsGenericKeywordWorkspace() {
  const { state } = useAsyncData<PlatformDirectoryReadModel>(() => loadPlatformDirectory());
  const [projectId, setProjectId] = useState("");
  return <><OpsPageHeader title="关键词与需求数据" description="统一管理可选关键词资料及其真实需求证据；百度数据仅作为兼容来源之一。" /><OpsAsyncView state={state}>{(model) => {
    const project = model.projects.find((item) => item.id === projectId);
    return <><section className={opsPageStyles.panel}><label className={opsPageStyles.field}><span>操作项目</span><select className={opsPageStyles.search} value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">请选择客户项目</option>{model.projects.map((item) => <option key={item.id} value={item.id}>{item.clientOrganizationName} · {item.name}</option>)}</select></label></section>{project ? <GenericKeywordWorkspace projectId={project.id} questionsHref="/ops/keyword-expansion" /> : <section className={opsPageStyles.state} role="status"><strong>请选择操作项目</strong><span>选择后才会读取项目范围内的真实数据。</span></section>}</>;
  }}</OpsAsyncView></>;
}
