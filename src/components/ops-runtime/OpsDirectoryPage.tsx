"use client";

import { useState } from "react";
import { useAsyncData } from "../runtime/index.js";
import { OpsAsyncView } from "./OpsAsyncView.js";
import { OpsPageHeader, opsPageStyles } from "./OpsPage.js";
import { displayDate, loadPlatformDirectory, type PlatformDirectoryReadModel } from "./platform-read-model.js";

export function OpsOrganizationDirectoryPage({ type, title, description }: { readonly type: "AGENCY"|"CLIENT"; readonly title: string; readonly description: string }) {
  const { state } = useAsyncData<PlatformDirectoryReadModel>(() => loadPlatformDirectory());
  const [query, setQuery] = useState("");
  return <><OpsPageHeader title={title} description={description} /><OpsAsyncView state={state}>{(model) => {
    const rows = model.organizations.filter((item) => item.type === type && item.displayName.toLocaleLowerCase("zh-CN").includes(query.trim().toLocaleLowerCase("zh-CN")));
    return <section className={opsPageStyles.panel}>
      <input className={opsPageStyles.search} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`搜索${title.replace("管理", "")}`} aria-label={`搜索${title.replace("管理", "")}`} />
      <div className={opsPageStyles.tableWrap}><table className={opsPageStyles.table}><thead><tr><th>名称</th><th>状态</th><th>建立时间</th></tr></thead><tbody>
        {rows.map((item) => <tr key={item.id}><td>{item.displayName}</td><td><span className={opsPageStyles.status}>{item.status === "ACTIVE" ? "正常" : item.status === "SUSPENDED" ? "已停用" : "已归档"}</span></td><td>{displayDate(item.createdAt)}</td></tr>)}
        {rows.length === 0 ? <tr><td colSpan={3} className={opsPageStyles.muted}>暂无匹配记录。</td></tr> : null}
      </tbody></table></div>
    </section>;
  }}</OpsAsyncView></>;
}

export function OpsProjectsPageView() {
  const { state } = useAsyncData<PlatformDirectoryReadModel>(() => loadPlatformDirectory());
  const [query, setQuery] = useState("");
  return <><OpsPageHeader title="项目管理" description="展示平台当前客户项目，项目范围由服务端权限校验。" /><OpsAsyncView state={state}>{(model) => {
    const rows = model.projects.filter((item) => `${item.name} ${item.clientOrganizationName}`.toLocaleLowerCase("zh-CN").includes(query.trim().toLocaleLowerCase("zh-CN")));
    return <section className={opsPageStyles.panel}><input className={opsPageStyles.search} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索项目或客户" aria-label="搜索项目或客户" /><div className={opsPageStyles.tableWrap}><table className={opsPageStyles.table}><thead><tr><th>项目名称</th><th>所属客户</th><th>建立时间</th></tr></thead><tbody>{rows.map((item) => <tr key={item.id}><td>{item.name}</td><td>{item.clientOrganizationName}</td><td>{displayDate(item.createdAt)}</td></tr>)}{rows.length === 0 ? <tr><td colSpan={3} className={opsPageStyles.muted}>暂无匹配项目。</td></tr> : null}</tbody></table></div></section>;
  }}</OpsAsyncView></>;
}
