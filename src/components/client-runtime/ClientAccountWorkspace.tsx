"use client";

import { useState } from "react";
import { AccountRegistrationPanel, accountHealthLabel, accountStatusLabel, authorizationStatusLabel, credentialStatusLabel, operationModeLabel } from "../account-keyword-runtime/index.js";
import { ActionFeedback } from "../account-keyword-runtime/ActionFeedback.js";
import { accountKeywordApi } from "../account-keyword-runtime/api.js";
import { useAsyncData } from "../runtime/index.js";
import { getAccountCenter } from "../../lib/api-client/domestic.js";
import { ok, type Result } from "../../lib/api-client/http.js";
import { ACCOUNT_PLATFORM_REGISTRY } from "../../runtime/accounts/platform-registry.js";
import type { AccountCenterReadModel } from "../../runtime/read-models/domestic-workspaces.js";
import type { AccountViewV1 } from "../../runtime/api-contracts/index.js";
import { loadAccount } from "./endpoints.js";
import { AsyncSection } from "./AsyncSection.js";
import { UnavailableState } from "./UnavailableState.js";

interface ClientAccountData { readonly session: AccountViewV1; readonly center: AccountCenterReadModel }
async function loadClientAccounts(): Promise<Result<ClientAccountData>> {
  const session = await loadAccount(); if (!session.ok) return session;
  const center = await getAccountCenter(); if (!center.ok) return center;
  return ok({ session: session.data, center: center.data });
}

export function ClientAccountWorkspace() {
  const resource = useAsyncData(loadClientAccounts);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [result, setResult] = useState<Result<unknown> | null>(null);
  async function authorize(accountId: string, clientOrganizationId: string) {
    setPendingId(accountId); setResult(null);
    try { const response = await accountKeywordApi.authorizeAccount(accountId, { clientOrganizationId }); setResult(response); if (response.ok) resource.reload(); }
    catch { setResult({ ok: false, code: "INTERNAL_ERROR", message: "网络请求失败" }); }
    finally { setPendingId(null); }
  }
  return <AsyncSection state={resource.state} onRetry={resource.reload}>{(data) => {
    const clientOrganizationId = data.session.activeClientOrganizationId;
    if (!clientOrganizationId) return <UnavailableState title="客户身份不可用">当前登录会话没有可确认的企业范围，因此不能登记或授权账号。</UnavailableState>;
    return <div className="cp-stack">
      <section className="cp-card"><h2>登记客户账号</h2><AccountRegistrationPanel platforms={ACCOUNT_PLATFORM_REGISTRY.map((p) => ({ code: p.code, label: p.displayName, type: p.accountType }))} ownership="CLIENT_OWNED" clientOrganizationId={clientOrganizationId} onRegistered={resource.reload} /></section>
      <section className="cp-card"><h2>已登记账号</h2>{data.center.accounts.length === 0 ? <div className="cp-empty-state"><h3>本企业尚未登记账号</h3><p>请先在上方选择平台并填写账号名称。登记后可在此确认授权；系统不会自动登录，也不会读取密码或令牌。</p><button className="cp-button cp-button-primary" type="button" onClick={() => document.querySelector<HTMLInputElement>("input[placeholder='例如：品牌内容运营账号']")?.focus()}>开始登记</button></div> : <div className="cp-table-wrap"><table className="cp-data-table"><thead><tr><th>平台与账号</th><th>账号状态</th><th>授权</th><th>凭据状态</th><th>账号健康</th><th>最近检查</th><th>授权项目</th><th>操作</th></tr></thead><tbody>{data.center.accounts.map((account) => <tr key={account.id}><td>{ACCOUNT_PLATFORM_REGISTRY.find((p) => p.code === account.platformCode)?.displayName ?? "未知平台"}<br />{account.displayLabel}</td><td>{accountStatusLabel[account.status]}</td><td>{account.authorizationStatus ? authorizationStatusLabel[account.authorizationStatus] : "待授权"}</td><td>{credentialStatusLabel[account.credentialStatus]}</td><td>{accountHealthLabel[account.healthStatus]}{account.lastException?<><br/>最近异常：{account.lastException}</>:null}</td><td>{account.lastCheckedAt?new Date(account.lastCheckedAt).toLocaleString("zh-CN"):"尚未检查"}</td><td>{account.authorizedProjects.length?account.authorizedProjects.map((project)=><div key={project.id}>{project.name}</div>):"尚未授权项目"}</td><td>{account.authorizationStatus !== "AUTHORIZED" && account.status === "ACTIVE" ? <button className="cp-button cp-button-primary" type="button" disabled={pendingId !== null} onClick={() => void authorize(account.id, clientOrganizationId)}>{pendingId === account.id ? "授权中…" : "确认授权"}</button> : operationModeLabel[account.operationMode]}</td></tr>)}</tbody></table></div>}
      <ActionFeedback pending={pendingId !== null} result={result} successText="账号授权已记录。" /></section>
      <UnavailableState title="撤销授权尚未开放">当前后端没有撤销授权命令，本页不会显示无效的撤销按钮。</UnavailableState>
      <p className="cp-callout">页面不接收或展示密码、登录凭据、令牌和访问密钥；平台公共账号不会出现在客户列表中。</p>
    </div>;
  }}</AsyncSection>;
}
