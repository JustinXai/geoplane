"use client";

import { AgencyDeliveryActions } from "@/components/agency-delivery-runtime";
import { AgencyAsyncView, getAgencyPortfolio } from "@/components/agency-runtime";
import { useAsyncData } from "@/components/runtime";
import type { AgencyPortfolioSummary } from "@/runtime/agency-delivery/contracts";

const stageLabel: Record<string, string> = {
  CLIENT_PROFILE: "客户资料",
  PROJECT_PROFILE: "项目资料",
  ENTERPRISE_KNOWLEDGE: "企业知识",
  ACCOUNT_AUTHORIZATION: "账号授权",
  BAIDU_KEYWORDS: "百度关键词",
  AI_EXPANSION: "AI 拓词",
  USER_QUESTION_CONFIRMATION: "用户问题确认",
  CONTENT_TASK: "内容任务",
  CONTENT_REVIEW: "内容审核",
  CHINA_AI_PROBE: "独立检测原型（历史阶段）",
  REPORT: "报告",
  DELIVERY: "交付",
  RETROSPECTIVE: "复盘",
};

const deliveryLabel = { NOT_READY: "尚未就绪", READY: "待人工交付", DELIVERED: "已交付" } as const;

export default function AgencyDeliveryPackagesPage() {
  const { state } = useAsyncData<AgencyPortfolioSummary>(() => getAgencyPortfolio());
  return <><header className="cp-page-header"><div><p className="eyebrow">代理商工作台</p><h1>交付中心</h1><span>推进授权客户项目，并登记真实人工交付；系统不会自动发布。</span></div></header>
    <AgencyAsyncView state={state} empty={<p className="cp-empty-state">当前没有可交付的授权客户项目。</p>}>
      {(portfolio) => <div className="cp-stack">{portfolio.clients.map((item) => <section className="cp-stack" id={item.delivery.status==="DELIVERED"?"delivered":undefined} key={item.projectId}><div className="cp-section"><div className="cp-section-header"><div><h2>{item.projectName}</h2><p>{item.clientName} · 当前阶段：{stageLabel[item.currentStage] ?? "待确认"} · 交付状态：{deliveryLabel[item.delivery.status]}{item.delivery.deliveredAt?` · ${new Date(item.delivery.deliveredAt).toLocaleString("zh-CN")}`:""}</p></div></div></div><AgencyDeliveryActions agencyOrganizationId={portfolio.agencyOrganizationId} clientOrganizationId={item.clientOrganizationId} projectId={item.projectId} currentStage={item.currentStage} canMarkReady={item.delivery.status === "NOT_READY"&&(item.currentStage==="DELIVERY"||item.currentStage==="RETROSPECTIVE")} canRegisterDelivered={item.delivery.status === "READY"}/></section>)}</div>}
    </AgencyAsyncView>
  </>;
}
