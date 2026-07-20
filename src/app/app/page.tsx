"use client";

import Link from "next/link";
import { useAsyncData } from "../../components/runtime/index.js";
import { AsyncSection } from "../../components/client-runtime/AsyncSection.js";
import { loadClientOverview } from "../../components/client-runtime/endpoints.js";
import { toProjectSummary } from "../../components/client-runtime/view-models.js";
import { buildClientOverview } from "../../components/client-runtime/overview-view-model.js";

export default function ClientWorkspaceHomePage() {
  const overview = useAsyncData(loadClientOverview, { isEmpty: (value) => value === null });
  return (
    <>
      <header className="cp-page-header"><div><p className="eyebrow">客户工作台</p><h1>项目总览</h1><span>查看当前项目的真实业务进度与下一步操作。</span></div></header>
      <AsyncSection state={overview.state} onRetry={overview.reload} empty={<div className="cp-empty-state"><strong>当前账号暂无可访问项目</strong><p>当企业尚未分配项目，或项目授权已结束时会显示此状态。请联系负责该客户的代理商或平台运营人员完成分配。</p><button className="cp-button" type="button" onClick={overview.reload}>重新检查项目</button></div>}>
        {(data) => {
          if (data === null) return null;
          const project = toProjectSummary(data.project);
          const summary = buildClientOverview(data);
          return <>
            <section className="cp-section"><h2>{project.name}</h2><p>{project.clientOrganizationName} · 所有数字均来自当前项目的已保存业务记录。</p></section>
            <section className="cp-card-grid" aria-label="项目业务指标">
              {summary.metrics.map(metric=><Link className="cp-card" href={metric.href} key={metric.label}><p className="cp-card-value">{metric.value}</p><p className="cp-card-label">{metric.label}</p><p className="cp-list-meta">{metric.source}</p></Link>)}
            </section>
            <div className="cp-stack">
              <section className="cp-section" id="knowledge-progress"><h2>企业资料进度</h2><p>知识包 {data.knowledge.packageCount} 个 · 已确认 {data.knowledge.confirmedPackageCount} 个 · 资料文件 {data.knowledge.documentCount} 份 · 待补资料 {data.knowledge.missingInformationCount} 项</p><p className="cp-list-meta">当前进度按已保存资料、确认状态和待补事项汇总，可直接进入资料页继续补齐。</p><Link className="cp-button" href="/app/enterprise">进入企业资料</Link></section>
              <section className="cp-section" id="keyword-progress"><h2>关键词与需求数据</h2><p>数据集 {data.keywordData.datasets.length} 个 · 关键词 {data.keywordData.records.length} 条 · 真实需求证据 {data.keywordData.evidence.length} 项 · 来源 {new Set(data.keywordData.datasets.map(item=>item.source)).size} 类</p>{data.keywordData.records.length===0?<div className="cp-stack"><p className="cp-placeholder-note">关键词资料完全可选，不会阻断内容生产与交付。可直接从企业知识生成，也可补充通用文件或手动关键词。</p><div className="cp-actions"><Link className="cp-button cp-button-primary" href="/app/questions">基于企业知识生成</Link><Link className="cp-button" href="/app/keywords#keyword-input">导入或手动添加</Link></div></div>:<Link className="cp-button" href="/app/keywords">查看关键词与需求数据</Link>}</section>
              <section className="cp-section" id="question-progress"><h2>用户问题进度</h2><p>已确认 {summary.confirmedQuestions} 个 · 待确认 {summary.pendingQuestions} 个</p><Link className="cp-button" href="/app/questions">查看并确认用户问题</Link></section>
              <section className="cp-section" id="content-progress"><h2>内容与交付进度</h2><p>生产中 {data.deliveries.filter(item=>item.status==="IN_PRODUCTION").length} 篇 · 审核中 {data.deliveries.filter(item=>item.status==="IN_REVIEW").length} 篇 · 已交付 {data.deliveries.filter(item=>item.status==="DELIVERED").length} 篇</p><div className="cp-actions"><Link className="cp-button" href="/app/content">查看内容方向</Link><Link className="cp-button" href="/app/delivery">查看交付记录</Link></div></section>
              <section className="cp-section" aria-label="风险提示"><h2>当前风险</h2>{summary.risks.length===0?<div className="cp-empty-state"><strong>未发现可由当前数据判定的阻断风险</strong><p>此结论覆盖企业资料、关键词导入异常和当前内容交付状态；外部检测不属于主系统阻断项。</p></div>:<div className="cp-stack">{summary.risks.map(risk=><p className="notice notice-warning" key={risk}>{risk}</p>)}</div>}</section>
              <section className="cp-section" aria-label="下一步操作"><h2>下一步操作</h2><div className="cp-card-grid">{summary.actions.map(action=><Link className="cp-card" href={action.href} key={action.label}><strong>{action.label}</strong><p>{action.reason}</p></Link>)}</div></section>
              <section className="cp-section"><h2>最近业务进度</h2>{summary.activities.length===0?<div className="cp-empty-state"><strong>暂无业务进度记录</strong><p>完成资料建档、生成用户问题、补充可选关键词资料或内容交付后，这里会按时间显示真实记录。</p><Link className="cp-button cp-button-primary" href="/app/questions">从企业知识生成用户问题</Link></div>:<div className="cp-list">{summary.activities.map(item=><div className="cp-list-row" key={`${item.label}-${item.occurredAt}`}><span className="cp-list-title">{item.label}<small className="cp-list-summary">{item.detail}</small></span><time className="cp-list-meta">{new Date(item.occurredAt).toLocaleString("zh-CN")}</time></div>)}</div>}</section>
              <section className="cp-section"><h2>当前能力边界</h2>{summary.gaps.map(gap=><div className="notice" key={gap.title}><strong>验收优先级 {gap.priority} · {gap.title}</strong><p>{gap.reason}</p></div>)}</section>
            </div>
          </>;
        }}
      </AsyncSection>
    </>
  );
}
