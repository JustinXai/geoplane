"use client";
import { useAsyncData } from "@/components/runtime";
import { AgencyAsyncView, getAgencyPortfolio } from "@/components/agency-runtime";
import type { AgencyPendingTaskKind, AgencyPortfolioSummary } from "@/runtime/agency-delivery/contracts";

const groups:readonly {id:string;kind:AgencyPendingTaskKind;label:string}[]=[
  {id:"knowledge",kind:"COMPLETE_KNOWLEDGE",label:"补齐企业资料"},{id:"keywords",kind:"CONFIRM_KEYWORDS",label:"确认关键词"},
  {id:"questions",kind:"CONFIRM_QUESTIONS",label:"确认用户问题"},{id:"content",kind:"REVIEW_CONTENT",label:"审核内容"},
  {id:"delivery",kind:"DELIVER_PROJECT",label:"项目交付"},
];
export default function Page(){const {state}=useAsyncData<AgencyPortfolioSummary>(()=>getAgencyPortfolio());return <><header className="cp-page-header"><div><p className="eyebrow">代理商工作台</p><h1>待办中心</h1><span>逐项列出有效授权客户项目的真实待处理事项。</span></div></header>
  <AgencyAsyncView state={state}>{data=><div className="cp-stack">{groups.map(group=>{const rows=data.clients.flatMap(client=>client.pendingTasks.filter(task=>task.kind===group.kind).map(task=>({client,task})));return <section className="cp-section" id={group.id} key={group.id}><h2>{group.label}</h2>{rows.length===0?<p className="cp-empty-state">当前没有此类待办。</p>:<ul className="cp-list">{rows.map(({client,task})=><li className="cp-list-row" key={`${client.projectId}:${group.kind}`}><span className="cp-list-title">{client.clientName} · {client.projectName}</span><span className="cp-list-meta">{task.count} 项</span></li>)}</ul>}</section>})}<section className="cp-section" id="overdue"><h2>逾期任务</h2><p className="cp-empty-state">当前冻结数据模型没有任务截止时间或 SLA，无法可靠判断逾期；未生成推测数据。</p></section></div>}</AgencyAsyncView></>}
