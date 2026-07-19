"use client";
import { useState } from "react";
import { getPolicyPack } from "../../lib/api-client/domestic.js";
import type { PolicyPackReadModel } from "../../runtime/read-models/domestic-workspaces.js";
import { useAsyncData } from "../runtime/index.js";
import { OpsAsyncView } from "./OpsAsyncView.js";
import { OpsPageHeader, opsPageStyles } from "./OpsPage.js";
import { displayDate, loadPlatformDirectory, type PlatformDirectoryReadModel } from "./platform-read-model.js";

const categoryLabels:Readonly<Record<string,string>>={MEDICAL_ADVERTISING_BOUNDARY:"医疗广告限制",ABSOLUTE_WORDING:"绝对化用语",EFFICACY_COMMITMENT:"疗效承诺",INSTITUTION_QUALIFICATION:"机构资质",PRACTITIONER_QUALIFICATION:"医生资质",PRODUCT_QUALIFICATION:"产品资质",RISK_TERM_REVIEW:"风险词",EVIDENCE_REQUIREMENT:"证据要求"};
function packName(packId:string){return packId==="MEDICAL_AESTHETICS_V1"?"医疗医美规则":"通用 GEO 规则";}

function PackDetails({projectId}:{readonly projectId:string}){
  const {state}=useAsyncData<PolicyPackReadModel>(()=>getPolicyPack(projectId),{deps:[projectId]});
  return <OpsAsyncView state={state}>{(model)=>{
    const manualRules=model.pack.rules.filter((rule)=>rule.evaluationMode==="MANUAL_CONFIRMATION");
    return <>
      <section className={opsPageStyles.grid}>
        <div className={opsPageStyles.card}><p className={opsPageStyles.value}>{model.industry?.label??"通用行业"}</p><p className={opsPageStyles.label}>当前项目行业</p></div>
        <div className={opsPageStyles.card}><p className={opsPageStyles.value}>{packName(model.pack.packId)}</p><p className={opsPageStyles.label}>当前生效规则包</p></div>
        <div className={opsPageStyles.card}><p className={opsPageStyles.value}>第 {model.pack.version} 版</p><p className={opsPageStyles.label}>规则包版本</p></div>
        <div className={opsPageStyles.card}><p className={opsPageStyles.value}>{displayDate(model.pack.effectiveFrom)}</p><p className={opsPageStyles.label}>生效时间</p></div>
      </section>
      <section className={opsPageStyles.panel}>
        <h2>当前生效规则</h2>
        {model.pack.rules.length===0?<p className={opsPageStyles.muted}>当前使用通用规则包，没有额外的行业专项规则；内容仍需经过既有质量门禁和人工审核。</p>:<ul className={opsPageStyles.list}>{model.pack.rules.map((rule)=><li key={rule.ruleId}><span>{categoryLabels[rule.category]??"业务规则"}</span><span className={opsPageStyles.muted}>{rule.evaluationMode==="MANUAL_CONFIRMATION"?"需要人工确认":"系统规则检查"}</span></li>)}</ul>}
      </section>
      <section className={opsPageStyles.panel}>
        <h2>需要人工确认的规则</h2>
        {manualRules.length===0?<p className={opsPageStyles.muted}>当前规则包没有额外的行业人工确认项；后续内容审核仍须由有权限的人员完成。</p>:<ul className={opsPageStyles.list}>{manualRules.map((rule)=><li key={rule.ruleId}><span>{categoryLabels[rule.category]??"业务规则"}</span><span className={opsPageStyles.muted}>必须由人工逐项确认</span></li>)}</ul>}
      </section>
      <section className={opsPageStyles.panel}>
        <h2>为什么不能切换规则包</h2>
        <p className={opsPageStyles.muted}>{model.switching.reason}</p>
      </section>
      <section className={opsPageStyles.panel}>
        <h2>最近评估结果</h2>
        {model.recentEvaluations.length===0?<p className={opsPageStyles.muted}>当前还没有评估记录。内容进入行业门禁评估后，真实结果会显示在这里。</p>:<div className={opsPageStyles.tableWrap}><table className={opsPageStyles.table}><thead><tr><th>规则类别</th><th>结果</th><th>处理说明</th><th>评估时间</th></tr></thead><tbody>{model.recentEvaluations.map((item,index)=><tr key={`${item.category}-${item.evaluatedAt}-${index}`}><td>{categoryLabels[item.category]??"业务规则"}</td><td>{item.status==="PASSED"?"通过":"需要处理"}</td><td>{item.failureReasons.length===0?"无待处理说明":item.failureReasons.join("；")}</td><td>{displayDate(item.evaluatedAt)}</td></tr>)}</tbody></table></div>}
      </section>
    </>;
  }}</OpsAsyncView>;
}

export function OpsPolicyPackPage(){const {state}=useAsyncData<PlatformDirectoryReadModel>(()=>loadPlatformDirectory());const [selectedIndex,setSelectedIndex]=useState("");return <><OpsPageHeader title="行业规则包" description="查看项目当前加载的规则包、人工确认要求与真实评估结果。"/><OpsAsyncView state={state}>{(model)=>{const index=Number(selectedIndex);const project=selectedIndex!==""&&Number.isInteger(index)?model.projects[index]:undefined;return <><section className={opsPageStyles.panel}><label className={opsPageStyles.field}><span>查看项目</span><select className={opsPageStyles.search} value={selectedIndex} onChange={(event)=>setSelectedIndex(event.target.value)}><option value="">请选择客户项目</option>{model.projects.map((item,position)=><option key={item.id} value={String(position)}>{item.clientOrganizationName} · {item.name}</option>)}</select></label><p className={opsPageStyles.muted}>页面仅展示已恢复的规则类别和评估事实，不提供法律结论或臆造的合规评分。</p></section>{project?<PackDetails projectId={project.id}/>:<section className={opsPageStyles.state}><strong>请选择项目</strong><span>选择后读取该项目当前生效的行业规则包。</span></section>}</>;}}</OpsAsyncView></>}
