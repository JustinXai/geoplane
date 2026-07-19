"use client";
import { useState } from "react";
import { getManualProbeEntryOptions } from "../../lib/api-client/domestic.js";
import type { ManualProbeEntryOptions } from "../../runtime/read-models/domestic-workspaces.js";
import { ManualProbeWorkspace } from "../probe-report/index.js";
import { useAsyncData } from "../runtime/index.js";
import { OpsAsyncView } from "./OpsAsyncView.js";
import { OpsPageHeader, opsPageStyles } from "./OpsPage.js";

export function OpsManualProbePage(){const {state}=useAsyncData<ManualProbeEntryOptions>(()=>getManualProbeEntryOptions(),{isEmpty:(options)=>options.projects.length===0});const [selectedIndex,setSelectedIndex]=useState("");return <><OpsPageHeader title="独立检测系统人工原型" description="INDEPENDENT_DETECTION_SYSTEM_PROTOTYPE · 外部集成实验区；不参与主系统交付判定。"/><OpsAsyncView state={state} empty={<section className={opsPageStyles.state}><strong>暂无可供原型登记的项目</strong><span>原型仅从已确认问题中选择人工样本。</span></section>}>{(options)=>{const index=Number(selectedIndex);const selected=selectedIndex!==""&&Number.isInteger(index)?options.projects[index]:undefined;return <><section className={opsPageStyles.panel}><label className={opsPageStyles.field}><span>检测项目</span><select className={opsPageStyles.search} value={selectedIndex} onChange={(event)=>setSelectedIndex(event.target.value)}><option value="">请选择项目</option>{options.projects.map((project,position)=><option key={project.projectId} value={String(position)}>{project.clientName} · {project.projectName}</option>)}</select></label><p className={opsPageStyles.muted}>可用平台限定为豆包、通义千问、DeepSeek 和腾讯元宝；自动登录关闭，真实平台调用为 0。</p></section>{selected?<div className={opsPageStyles.probe}><ManualProbeWorkspace projectId={selected.projectId} questions={selected.questions.map((item)=>item.question)}/></div>:<section className={opsPageStyles.state}><strong>请选择检测项目</strong><span>选择后显示该项目已确认的问题与人工登记表单。</span></section>}</>;}}</OpsAsyncView></>}
