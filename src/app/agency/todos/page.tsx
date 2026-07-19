"use client";
import { useAsyncData } from "@/components/runtime";
import { AgencyAsyncView, getAgencyPortfolio } from "@/components/agency-runtime";
import type { AgencyPortfolioSummary } from "@/runtime/agency-delivery/contracts";

export default function Page(){
  const {state}=useAsyncData<AgencyPortfolioSummary>(()=>getAgencyPortfolio());
  return <><header className="cp-page-header"><div><p className="eyebrow">代理商工作台</p><h1>待办中心</h1><span>来自已授权客户项目的真实待处理事项。</span></div></header>
    <AgencyAsyncView state={state}>{data=><section className="cp-section"><h2>当前待办</h2><ul className="cp-list">
      <li className="cp-list-row"><span className="cp-list-title">补齐企业资料</span><span className="cp-list-meta">{data.clientsNeedingKnowledge} 个项目</span></li>
      <li className="cp-list-row"><span className="cp-list-title">确认关键词</span><span className="cp-list-meta">{data.clientsNeedingKeywordConfirmation} 个项目</span></li>
      <li className="cp-list-row"><span className="cp-list-title">审核内容</span><span className="cp-list-meta">{data.contentAwaitingReview} 项</span></li>
      <li className="cp-list-row"><span className="cp-list-title">人工探测</span><span className="cp-list-meta">{data.probeTasksPending === null ? "暂无可靠统计" : `${data.probeTasksPending} 项`}</span></li>
      <li className="cp-list-row"><span className="cp-list-title">项目交付</span><span className="cp-list-meta">{data.projectsAwaitingDelivery} 个项目</span></li>
    </ul></section>}</AgencyAsyncView></>;
}
