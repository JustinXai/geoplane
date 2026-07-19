"use client";
import { useState } from "react";
import { useAsyncData } from "@/components/runtime";
import { AgencyAsyncView } from "@/components/agency-runtime";
import { ManualProbeWorkspace } from "@/components/probe-report";
import { getManualProbeEntryOptions } from "@/lib/api-client/domestic";
import type { ManualProbeEntryOptions } from "@/runtime/read-models/domestic-workspaces";

export default function Page(){const {state}=useAsyncData<ManualProbeEntryOptions>(()=>getManualProbeEntryOptions(),{isEmpty:data=>data.projects.length===0});const [selectedId,setSelectedId]=useState("");return <><header className="cp-page-header"><div><p className="eyebrow">代理商工作台</p><h1>国内 AI 检测</h1><span>只允许从已授权项目和已确认问题中选择，系统不会自动登录或调用模型。</span></div></header><AgencyAsyncView state={state} empty={<p className="cp-placeholder-note">当前没有可进行国内 AI 检测的授权项目。请先确认客户项目和用户问题。</p>}>{options=>{const selected=options.projects.find(item=>item.projectId===selectedId)??options.projects[0];if(!selected)return null;return <div className="cp-stack"><section className="cp-section"><label className="cp-field"><span className="cp-field-label">当前操作项目</span><select className="cp-input" value={selected.projectId} onChange={event=>setSelectedId(event.target.value)}>{options.projects.map(item=><option key={item.projectId} value={item.projectId}>{item.clientName} · {item.projectName}</option>)}</select></label><p className="cp-placeholder-note">可登记平台：{options.platforms.map(item=>item.displayName).join("、")}</p></section><ManualProbeWorkspace key={selected.projectId} projectId={selected.projectId} questions={selected.questions.map(item=>item.question)}/></div>}}</AgencyAsyncView></>}
