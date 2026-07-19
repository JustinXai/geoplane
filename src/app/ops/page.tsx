"use client";

import Link from "next/link";
import { useAsyncData } from "@/components/runtime";
import {
  displayDate,
  loadPlatformOpsHome,
  OpsAsyncView,
  OpsPageHeader,
  opsPageStyles,
  recentBusinessProgress,
  toSafeOpsAuditRow,
  type PlatformOpsHomeReadModel,
  type PlatformOverviewQueueItem,
} from "@/components/ops-runtime";

const count = (items: readonly PlatformOverviewQueueItem[]) => items.reduce((sum, item) => sum + item.count, 0);

export default function OpsWorkspaceHomePage() {
  const { state, reload } = useAsyncData<PlatformOpsHomeReadModel>(() => loadPlatformOpsHome());
  return <>
    <OpsPageHeader title="运营总览" description="用真实组织、项目、内容、检测、账号与审计记录回答当前进度、待办、风险和下一步。" />
    <OpsAsyncView state={state} empty={<section className={opsPageStyles.state}><strong>暂无运营数据</strong><span>当前尚未建立组织或项目；完成组织与项目创建后，本页开始汇总真实进度。</span></section>}>
      {(home) => {
        const { overview } = home;
        const progress = recentBusinessProgress(home.directory);
        return <>
          <div className={opsPageStyles.toolbar}><p>数据来源：{overview.sources.join("、")}。所有数字均可回到业务明细核验；当前项目模型没有停用状态，因此已建立项目均计为活跃。</p><button type="button" className="button button-secondary" onClick={reload}>刷新总览</button></div>
          <section className={opsPageStyles.grid} aria-label="运营指标">
            <Metric label="代理商" value={overview.totals.agencies} href="/ops/agencies" />
            <Metric label="客户" value={overview.totals.clients} href="/ops/clients" />
            <Metric label="活跃项目" value={overview.totals.activeProjects} href="/ops/projects" />
            <Metric label="待处理事项" value={overview.totals.pendingItems} href="#pending-work" tone={overview.totals.pendingItems > 0 ? "attention" : "normal"} />
          </section>

          <section className={opsPageStyles.panel} id="pending-work">
            <div className={opsPageStyles.sectionHeading}><div><h2>当前待办</h2><p>按真实状态汇总；点击业务入口后可继续筛选或处理。</p></div></div>
            <div className={opsPageStyles.queueGrid}>
              <Queue title="待人工审核内容" items={overview.queues.contentReview} total={count(overview.queues.contentReview)} href="/ops/projects" action="查看项目" empty="当前没有进入人工审核的内容。" note="来源：各项目最新内容版本与人工批准记录。" />
              <Queue title="待执行国内 AI 检测" items={overview.queues.aiDetection} total={count(overview.queues.aiDetection)} href="/ops/probes" action="进入检测" empty="已确认问题均已至少登记一条人工检测样本。" note="口径：已人工确认、但尚无任何检测样本的问题。" />
              <Queue title="待交付内容" items={overview.queues.delivery} total={count(overview.queues.delivery)} href="/ops/projects" action="查看项目" empty="当前没有已批准但尚未交付的内容。" note="来源：人工批准与真实交付记录；自动发布保持关闭。" />
            </div>
          </section>

          <section className={opsPageStyles.twoColumns} aria-label="风险与进度">
            <div className={opsPageStyles.panel}>
              <div className={opsPageStyles.sectionHeading}><div><h2>需要关注的风险</h2><p>只列已记录的异常事实，不推测风险。</p></div><Link className={opsPageStyles.textLink} href="/ops/accounts#account-list">账号明细</Link></div>
              <dl className={opsPageStyles.riskList}>
                <Risk label="异常账号" value={overview.risks.abnormalAccounts.length} />
                <Risk label="失败的账号操作任务" value={overview.risks.failedAccountTasks} />
                <Risk label="失败的人工检测样本" value={overview.risks.failedDetectionSamples} />
              </dl>
              {overview.risks.abnormalAccounts.length > 0 ? <ul className={opsPageStyles.compactList}>{overview.risks.abnormalAccounts.slice(0, 4).map((account) => <li key={account.accountId}><span>{account.displayLabel}</span><span>{account.failedTaskCount} 项失败 / {account.pendingTaskCount} 项待处理</span></li>)}</ul> : <p className={opsPageStyles.goodState}>当前没有已记录的账号异常。</p>}
            </div>
            <div className={opsPageStyles.panel}>
              <div className={opsPageStyles.sectionHeading}><div><h2>近七日业务进度</h2><p>来源：审计中心真实业务事件。</p></div><Link className={opsPageStyles.textLink} href="/ops/audit">查看审计</Link></div>
              {progress.length === 0 ? <p className={opsPageStyles.muted}>近七日暂无业务记录。</p> : <ul className={opsPageStyles.compactList}>{progress.slice(0, 6).map((event) => { const row = toSafeOpsAuditRow(event); return <li key={event.id}><span>{row.action} · {row.actorLabel}</span><time>{displayDate(event.occurredAt)}</time></li>; })}</ul>}
            </div>
          </section>

          <section className={opsPageStyles.boundary} aria-label="能力边界">
            <h2>统计能力边界</h2>
            <p><b>P0 边界：</b>内容驳回与检测失败目前没有统一的跨业务任务实体，因此本页按内容、检测和账号来源分别展示，不合并成一个“失败任务”数字。</p>
            <p><b>P1 边界：</b>跨项目处理时效、趋势和效果监测尚无稳定读模型；完成独立能力建设前不展示估算图表。</p>
          </section>
        </>;
      }}
    </OpsAsyncView>
  </>;
}

function Metric({ label, value, href, tone = "normal" }: { readonly label: string; readonly value: number; readonly href: string; readonly tone?: "normal"|"attention" }) {
  return <Link className={`${opsPageStyles.card} ${tone === "attention" ? opsPageStyles.attentionCard : ""}`} href={href}><p className={opsPageStyles.value}>{value}</p><p className={opsPageStyles.label}>{label}<span>查看明细 →</span></p></Link>;
}

function Queue({ title, items, total, href, action, empty, note }: { readonly title: string; readonly items: readonly PlatformOverviewQueueItem[]; readonly total: number; readonly href: string; readonly action: string; readonly empty: string; readonly note?: string }) {
  return <article className={opsPageStyles.queue}><div className={opsPageStyles.queueHeader}><div><strong>{total}</strong><span>{title}</span></div><Link className={opsPageStyles.textLink} href={href}>{action}</Link></div>{note ? <p className={opsPageStyles.queueNote}>{note}</p> : null}{items.length === 0 ? <p className={opsPageStyles.goodState}>{empty}</p> : <ul className={opsPageStyles.compactList}>{items.slice(0, 5).map((item) => <li key={item.projectId}><span>{item.clientName} · {item.projectName}</span><b>{item.count} 项</b></li>)}</ul>}</article>;
}

function Risk({ label, value }: { readonly label: string; readonly value: number }) {
  return <div><dt>{label}</dt><dd className={value > 0 ? opsPageStyles.riskValue : opsPageStyles.safeValue}>{value}</dd></div>;
}
