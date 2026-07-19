"use client";
import { useAsyncData } from "@/components/runtime";
import { AgencyAsyncView, getAgencyClients } from "@/components/agency-runtime";
import { AccountRegistrationPanel, accountHealthLabel, accountRiskLabel, accountStatusLabel, authorizationStatusLabel, credentialStatusLabel, ownershipLabel } from "@/components/account-keyword-runtime";
import { getAccountCenter } from "@/lib/api-client/domestic";
import type { AccountCenterReadModel } from "@/runtime/read-models/domestic-workspaces";
import { ACCOUNT_PLATFORM_REGISTRY } from "@/runtime/accounts/platform-registry";
import type { Result } from "@/lib/api-client";

interface View { readonly agencyOrganizationId: string; readonly accounts: AccountCenterReadModel }
async function load(): Promise<Result<View>> { const agency=await getAgencyClients(); if(!agency.ok)return agency; const accounts=await getAccountCenter(); if(!accounts.ok)return accounts; return {ok:true,data:{agencyOrganizationId:agency.data.agencyOrganizationId,accounts:accounts.data}}; }
const platforms=ACCOUNT_PLATFORM_REGISTRY.map((item)=>({code:item.code,label:item.displayName,type:item.accountType}));

export default function Page(){const {state,reload}=useAsyncData<View>(load);return <><header className="cp-page-header"><div><p className="eyebrow">代理商工作台</p><h1>账号中心</h1><span>查看当前代理商及已授权客户范围内的账号；敏感凭据不会在页面显示。</span></div></header>
  <AgencyAsyncView state={state}>{({agencyOrganizationId,accounts})=><div className="cp-stack"><section className="cp-section"><h2>账号概览</h2><p>账号 {accounts.totals.all} 个 · 需要关注 {accounts.totals.needsAttention} 个 · 待处理任务 {accounts.totals.pendingTasks} 项</p>
    {accounts.accounts.length===0?<p className="cp-placeholder-note">当前范围内暂无账号。</p>:<div className="cp-table-wrap"><table className="cp-data-table"><thead><tr><th>账号</th><th>归属</th><th>账号状态</th><th>凭据状态</th><th>授权</th><th>健康与风险</th><th>项目分配</th></tr></thead><tbody>{accounts.accounts.map((account)=><tr key={account.id}><td>{account.displayLabel}</td><td>{ownershipLabel[account.ownership]}</td><td>{accountStatusLabel[account.status]}</td><td>{credentialStatusLabel[account.credentialStatus]}</td><td>{account.authorizationStatus===null?"尚未授权":authorizationStatusLabel[account.authorizationStatus]}</td><td>{accountHealthLabel[account.healthStatus]} / {accountRiskLabel[account.riskStatus]}</td><td>{account.assignmentCount} 个项目</td></tr>)}</tbody></table></div>}
  </section><section className="cp-section"><h2>登记代理商自有账号</h2><AccountRegistrationPanel platforms={platforms} ownership="AGENCY_OWNED" agencyOrganizationId={agencyOrganizationId} onRegistered={reload}/></section></div>}</AgencyAsyncView></>}
