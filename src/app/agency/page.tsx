"use client";

import { useAsyncData } from "@/components/runtime";
import { AgencyAsyncView, getAgencyPortfolio } from "@/components/agency-runtime";
import type { AgencyPortfolioSummary } from "@/runtime/agency-delivery/contracts";

const metric = (href:string,label:string,value:string) => <li className="cp-list-row"><span className="cp-list-title">{label}</span><a className="cp-button" href={href}>{value}</a></li>;

export default function AgencyWorkspaceHomePage() {
  const { state } = useAsyncData<AgencyPortfolioSummary>(() => getAgencyPortfolio());
  return <><header className="cp-page-header"><div><p className="eyebrow">代理商工作台</p><h1>代理商总览</h1><span>仅汇总当前代理商有效授权客户的真实业务进度，点击数字可查看对应明细。</span></div></header>
    <AgencyAsyncView state={state}>{(data) => <div className="cp-stack"><section className="cp-section"><h2>经营概览</h2><ul className="cp-list">
      {metric("/agency/clients","授权客户",`${data.authorizedClientCount} 家`)}
      {metric("/agency/projects","授权范围项目",`${data.activeProjectCount} 个`)}
      {metric("/agency/todos#knowledge","资料待补齐",`${data.clientsNeedingKnowledge} 个客户`)}
      {metric("/agency/todos#keywords","关键词待确认",`${data.clientsNeedingKeywordConfirmation} 个客户`)}
      {metric("/agency/todos#questions","用户问题待确认",`${data.questionsAwaitingConfirmation} 项`)}
      {metric("/agency/todos#content","内容待审核",`${data.contentAwaitingReview} 项`)}
      {metric("/agency/deliveries","待交付",`${data.projectsAwaitingDelivery} 个项目`)}
      {metric("/agency/deliveries#delivered","已完成交付",`${data.completedDeliveries} 个项目`)}
      {metric("/agency/accounts#attention","异常账号",`${data.abnormalAccounts} 个`)}
      {metric("/agency/todos#overdue","逾期任务",data.overdueTasks===null?"暂无可靠统计":`${data.overdueTasks} 项`)}
    </ul></section></div>}</AgencyAsyncView>
  </>;
}
