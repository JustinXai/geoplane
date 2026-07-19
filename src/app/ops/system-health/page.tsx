"use client";

import { useAsyncData } from "@/components/runtime";
import { OpsAsyncView, OpsBuildInfoPanel, OpsPageHeader, opsPageStyles } from "@/components/ops-runtime";
import type { Result } from "@/lib/api-client";

type Check={readonly name:string;readonly status:"PASS"|"WARN"|"FAIL";readonly blocker:boolean};
type Health={readonly status:"ready"|"not_ready";readonly checks:readonly Check[]};
const LABELS:Readonly<Record<string,string>>={database:"数据库连接",migrations:"数据库结构",environment:"运行配置",storage:"文件存储",provider:"外部调用开关"};

async function loadHealth():Promise<Result<Health>>{
  try{const response=await fetch("/api/health/ready",{headers:{Accept:"application/json"},cache:"no-store"});const body=await response.json() as Health;if(!body||!Array.isArray(body.checks))return {ok:false,code:"INTERNAL_ERROR",message:"健康检查返回内容不可识别。"};return {ok:true,data:body};}catch{return {ok:false,code:"INTERNAL_ERROR",message:"暂时无法读取系统健康状态。"};}
}

export default function Page(){const {state}=useAsyncData<Health>(()=>loadHealth());return <><OpsPageHeader title="系统健康" description="展示本地运行环境的安全就绪检查，不显示连接地址、密钥或其他敏感配置。"/><OpsAsyncView state={state}>{(health)=><><section className={opsPageStyles.grid}><div className={opsPageStyles.card}><p className={opsPageStyles.value}>{health.status==="ready"?"运行正常":"需要处理"}</p><p className={opsPageStyles.label}>当前状态</p></div><div className={opsPageStyles.card}><p className={opsPageStyles.value}>{health.checks.filter((item)=>item.status==="PASS").length}/{health.checks.length}</p><p className={opsPageStyles.label}>检查通过</p></div></section><section className={opsPageStyles.panel}><h2>运行检查</h2><ul className={opsPageStyles.list}>{health.checks.map((check)=><li key={check.name}><span>{LABELS[check.name]??"系统检查"}</span><span className={check.status==="PASS"?opsPageStyles.status:opsPageStyles.muted}>{check.status==="PASS"?"正常":check.status==="WARN"?"请留意":"需要处理"}</span></li>)}</ul></section><OpsBuildInfoPanel/></>}</OpsAsyncView></>}
