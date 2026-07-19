"use client";
import { useState } from "react";
import { getManualProbeEntryOptions } from "../../lib/api-client/domestic.js";
import type { ManualProbeEntryOptions } from "../../runtime/read-models/domestic-workspaces.js";
import { ManualProbeWorkspace } from "../probe-report/index.js";
import { useAsyncData } from "../runtime/index.js";
import { OpsAsyncView } from "./OpsAsyncView.js";
import { OpsPageHeader, opsPageStyles } from "./OpsPage.js";

export function OpsManualProbePage(){const {state}=useAsyncData<ManualProbeEntryOptions>(()=>getManualProbeEntryOptions(),{isEmpty:(options)=>options.projects.length===0});const [selectedIndex,setSelectedIndex]=useState("");return <><OpsPageHeader title="国内 AI 查询" description="从服务端授权项目与已确认问题中选择，人工登记国内平台的真实查询样本。"/><OpsAsyncView state={state} empty={<section className={opsPageStyles.state}><strong>暂无可查询项目</strong><span>请先建立项目并完成用户问题确认。</span></section>}>{(options)=>{const index=Number(selectedIndex);const selected=selectedIndex!==""&&Number.isInteger(index)?options.projects[index]:undefined;return <><section className={opsPageStyles.panel}><label className={opsPageStyles.field}><span>查询项目</span><select className={opsPageStyles.search} value={selectedIndex} onChange={(event)=>setSelectedIndex(event.target.value)}><option value="">请选择已授权项目</option>{options.projects.map((project,position)=><option key={project.projectId} value={String(position)}>{project.clientName} · {project.projectName}</option>)}</select></label><p className={opsPageStyles.muted}>可用平台由服务端限定为豆包、通义千问、DeepSeek 和腾讯元宝；不提供自动登录或批量执行。</p></section>{selected?<div className={opsPageStyles.probe}><ManualProbeWorkspace projectId={selected.projectId} questions={selected.questions.map((item)=>item.question)}/></div>:<section className={opsPageStyles.state}><strong>请选择查询项目</strong><span>选择后显示该项目已确认的问题和人工样本表单。</span></section>}</>;}}</OpsAsyncView></>}
