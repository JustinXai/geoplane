"use client";

import Link from "next/link";
import { useAsyncData } from "../../components/runtime/index.js";
import { AsyncSection } from "../../components/client-runtime/AsyncSection.js";
import { loadClientOverview } from "../../components/client-runtime/endpoints.js";
import { toProjectSummary } from "../../components/client-runtime/view-models.js";

export default function ClientWorkspaceHomePage() {
  const overview = useAsyncData(loadClientOverview, { isEmpty: (value) => value === null });
  return (
    <>
      <header className="cp-page-header"><div><p className="eyebrow">客户工作台</p><h1>项目总览</h1><span>查看当前项目的真实业务进度与下一步操作。</span></div></header>
      <AsyncSection state={overview.state} onRetry={overview.reload} empty={<p className="cp-list-row cp-list-empty">暂无可访问项目。</p>}>
        {(data) => {
          if (data === null) return null;
          const project = toProjectSummary(data.project);
          const pendingQuestions = data.opportunities.filter((item) => item.review?.reviewStatus === "PENDING").length;
          const producing = data.deliveries.filter((item) => item.status === "IN_PRODUCTION").length;
          const reviewing = data.deliveries.filter((item) => item.status === "IN_REVIEW").length;
          const delivered = data.deliveries.filter((item) => item.status === "DELIVERED").length;
          return <>
            <section><h2>{project.name}</h2><p>{project.clientOrganizationName}</p></section>
            <section className="cp-card-grid" aria-label="项目业务指标">
              <div className="cp-card"><p className="cp-card-value">{data.keywords.length}</p><p className="cp-card-label">已整理关键词</p></div>
              <div className="cp-card"><p className="cp-card-value">{pendingQuestions}</p><p className="cp-card-label">待确认用户问题</p></div>
              <div className="cp-card"><p className="cp-card-value">{producing}</p><p className="cp-card-label">内容生产中</p></div>
              <div className="cp-card"><p className="cp-card-value">{reviewing}</p><p className="cp-card-label">待审核内容</p></div>
              <div className="cp-card"><p className="cp-card-value">{delivered}</p><p className="cp-card-label">已完成交付</p></div>
            </section>
            <section aria-label="下一步操作"><h2>下一步操作</h2><ul>
              {pendingQuestions > 0 ? <li><Link href="/app/questions">确认用户问题与内容方向</Link></li> : null}
              {reviewing > 0 ? <li><Link href="/app/content-review">处理待审核内容</Link></li> : null}
              <li><Link href="/app/enterprise">查看企业资料</Link></li>
              <li><Link href="/app/delivery">查看交付与报告</Link></li>
            </ul></section>
            <p className="cp-placeholder-note">企业资料完整度、AI 拓词待确认和待执行查询暂无客户侧汇总接口，因此不显示推测数值。</p>
          </>;
        }}
      </AsyncSection>
    </>
  );
}
