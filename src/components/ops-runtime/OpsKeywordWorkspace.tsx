"use client";
import { useState } from "react";
import { BaiduKeywordImportPanel, KeywordExpansionPanel } from "../account-keyword-runtime/index.js";
import { useAsyncData } from "../runtime/index.js";
import { OpsAsyncView } from "./OpsAsyncView.js";
import { OpsPageHeader, opsPageStyles } from "./OpsPage.js";
import { loadPlatformDirectory, type PlatformDirectoryReadModel } from "./platform-read-model.js";

export function OpsKeywordWorkspace({mode}:{readonly mode:"BAIDU"|"EXPANSION"}){
  const {state}=useAsyncData<PlatformDirectoryReadModel>(()=>loadPlatformDirectory());const [projectIndex,setProjectIndex]=useState("");
  const title=mode==="BAIDU"?"关键词中心":"AI 拓词任务";const description=mode==="BAIDU"?"将百度关键词参考文件导入明确的客户项目，并保留真实导入记录。":"基于明确项目进行离线组合拓词，所有候选结果必须人工确认。";
  return <><OpsPageHeader title={title} description={description}/><OpsAsyncView state={state}>{(model)=>{const selectedIndex=Number(projectIndex);const project=projectIndex!==""&&Number.isInteger(selectedIndex)?model.projects[selectedIndex]:undefined;return <><section className={opsPageStyles.panel}><label className={opsPageStyles.field}><span>操作项目</span><select className={opsPageStyles.search} value={projectIndex} onChange={(event)=>setProjectIndex(event.target.value)}><option value="">请选择客户项目</option>{model.projects.map((item,index)=><option value={String(index)} key={item.id}>{item.clientOrganizationName} · {item.name}</option>)}</select></label>{model.projects.length===0?<p className={opsPageStyles.muted}>当前没有可操作的真实项目，请先在项目管理中建立项目。</p>:null}</section>{project?<section className={opsPageStyles.panel}>{mode==="BAIDU"?<BaiduKeywordImportPanel projectId={project.id}/>:<KeywordExpansionPanel projectId={project.id}/>}</section>:<section className={opsPageStyles.state} role="status"><strong>请选择操作项目</strong><span>选择后才会显示真实业务表单，不会创建无项目归属的数据。</span></section>}</>;}}</OpsAsyncView></>;
}
