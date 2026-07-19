"use client";

import { useAsyncData } from "@/components/runtime";
import { activeProjectCount, displayDate, loadPlatformDirectory, OpsAsyncView, OpsPageHeader, opsPageStyles, organizationCount, recentBusinessProgress, toSafeOpsAuditRow, type PlatformDirectoryReadModel } from "@/components/ops-runtime";

export default function OpsWorkspaceHomePage() {
  const { state } = useAsyncData<PlatformDirectoryReadModel>(() => loadPlatformDirectory());
  return <>
    <OpsPageHeader title="运营总览" description="基于当前组织、项目和审计读取结果汇总平台业务进度。未具备读取能力的指标不会显示模拟数字。" />
    <OpsAsyncView state={state} empty={<section className={opsPageStyles.state}><strong>暂无运营数据</strong><span>当前尚未建立组织或项目。</span></section>}>
      {(model) => {
        const progress = recentBusinessProgress(model);
        return <>
          <section className={opsPageStyles.grid} aria-label="运营指标">
            <Metric label="代理商数量" value={organizationCount(model, "AGENCY")} />
            <Metric label="客户数量" value={organizationCount(model, "CLIENT")} />
            <Metric label="活跃项目" value={activeProjectCount(model)} />
            <Metric label="近七日业务进度" value={progress.length} />
          </section>
          <section className={opsPageStyles.panel}><h2>待办指标</h2><ul className={opsPageStyles.list}>
            {["待补资料项目", "待确认关键词", "待人工审核内容", "待执行国内 AI 检测", "待交付项目", "异常账号", "失败任务"].map((label) => <li key={label}><span>{label}</span><span className={opsPageStyles.muted}>暂无可靠统计</span></li>)}
          </ul></section>
          <section className={opsPageStyles.panel}><h2>最近业务进度</h2>{progress.length === 0 ? <p className={opsPageStyles.muted}>近七日暂无业务记录。</p> : <ul className={opsPageStyles.list}>{progress.slice(0, 8).map((event) => { const row = toSafeOpsAuditRow(event); return <li key={event.id}><span>{row.action} · {row.actorLabel}</span><time>{displayDate(event.occurredAt)}</time></li>; })}</ul>}</section>
        </>;
      }}
    </OpsAsyncView>
  </>;
}

function Metric({ label, value }: { readonly label: string; readonly value: number }) {
  return <div className={opsPageStyles.card}><p className={opsPageStyles.value}>{value}</p><p className={opsPageStyles.label}>{label}</p></div>;
}
