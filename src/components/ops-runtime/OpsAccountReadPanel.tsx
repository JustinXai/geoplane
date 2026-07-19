"use client";

import { useMemo, useState } from "react";
import { useAsyncData } from "../runtime/index.js";
import { getAccountCenter } from "../../lib/api-client/domestic.js";
import type { AccountCenterItem, AccountCenterReadModel } from "../../runtime/read-models/domestic-workspaces.js";
import { accountHealthLabel, accountRiskLabel, accountStatusLabel, credentialStatusLabel, operationModeLabel, ownershipLabel } from "../account-keyword-runtime/labels.js";
import { OpsAsyncView } from "./OpsAsyncView.js";
import { opsPageStyles } from "./OpsPage.js";

const platformNames:Readonly<Record<string,string>>={DOUBAO:"豆包",QWEN:"通义千问",DEEPSEEK:"DeepSeek",YUANBAO:"腾讯元宝",BAIJIAHAO:"百家号",TOUTIAO:"头条号",WECHAT_OFFICIAL:"微信公众号",ZHIHU:"知乎",XIAOHONGSHU:"小红书",SOHU:"搜狐号",NETEASE:"网易号",PENGUIN:"企鹅号",DOUYIN:"抖音",BILIBILI:"B站",CSDN:"CSDN",JIANSHU:"简书"};
type Filter="ALL"|"PLATFORM"|"ATTENTION"|"PENDING"|"FAILED";
const needsAttention=(item:AccountCenterItem)=>item.riskStatus==="ATTENTION"||item.riskStatus==="BLOCKED"||item.healthStatus==="DEGRADED"||item.healthStatus==="UNAVAILABLE"||item.credentialStatus==="EXPIRED"||item.credentialStatus==="REVOKED";
const time=(value:string|null)=>value?new Intl.DateTimeFormat("zh-CN",{dateStyle:"medium",timeStyle:"short"}).format(new Date(value)):"尚未检查";

export function OpsAccountReadPanel(){
  const {state,reload}=useAsyncData<AccountCenterReadModel>(()=>getAccountCenter());
  const [filter,setFilter]=useState<Filter>("ALL");
  return <section className={opsPageStyles.panel} id="account-list"><div className="section-heading"><div><h2>账号总览</h2><p>数据来源：账号中心实时读取结果。只展示业务状态，不返回凭证引用、令牌或登录信息。</p></div><button type="button" className="button button-secondary" onClick={reload}>刷新</button></div>
    <OpsAsyncView state={state}>{(model)=><AccountList model={model} filter={filter} onFilter={setFilter}/>}</OpsAsyncView>
  </section>;
}

function AccountList({model,filter,onFilter}:{model:AccountCenterReadModel;filter:Filter;onFilter:(filter:Filter)=>void}){
  const rows=useMemo(()=>model.accounts.filter((item)=>filter==="ALL"||(filter==="PLATFORM"&&item.ownership==="PLATFORM_OWNED")||(filter==="ATTENTION"&&needsAttention(item))||(filter==="PENDING"&&item.pendingTaskCount>0)||(filter==="FAILED"&&item.failedTaskCount>0)),[model.accounts,filter]);
  const metrics:[Filter,string,number][]=[["ALL","账号总数",model.totals.all],["PLATFORM","平台自有",model.totals.platformOwned],["ATTENTION","异常账号",model.totals.needsAttention],["PENDING","待处理任务",model.totals.pendingTasks],["FAILED","失败任务",model.totals.failedTasks]];
  return <><div className={opsPageStyles.grid}>{metrics.map(([key,label,value])=><button key={key} type="button" className={opsPageStyles.card} aria-pressed={filter===key} onClick={()=>onFilter(key)}><p className={opsPageStyles.value}>{value}</p><p className={opsPageStyles.label}>{label} · 查看列表</p></button>)}</div>
    {model.accounts.length===0?<div className="cp-empty-state"><h3>尚未登记平台账号</h3><p>账号为空是因为还没有完成账号登记。请先选择国内 AI 平台或内容平台，并填写便于识别的账号名称。</p><p>登记后账号默认采用人工操作，不会自动登录，也不会调用真实平台。</p><a className="button button-primary" href="#register-account">登记第一个账号</a></div>
    :rows.length===0?<div className="cp-empty-state"><h3>当前筛选条件下没有账号</h3><p>账号数据已读取，但没有符合“{metrics.find(([key])=>key===filter)?.[1]}”条件的记录。</p><button className="button button-secondary" type="button" onClick={()=>onFilter("ALL")}>查看全部账号</button></div>
    :<div className={opsPageStyles.tableWrap}><table className={opsPageStyles.table}><thead><tr><th>平台与账号</th><th>归属</th><th>状态与异常</th><th>最近检查</th><th>授权项目</th><th>操作方式</th></tr></thead><tbody>{rows.map((item)=><tr key={item.id}><td>{platformNames[item.platformCode]??"国内平台"}<br/><strong>{item.displayLabel}</strong></td><td>{ownershipLabel[item.ownership]}</td><td>{accountStatusLabel[item.status]} · {item.credentialConfigured?credentialStatusLabel[item.credentialStatus]:"待配置"}<br/>{accountHealthLabel[item.healthStatus]} · {accountRiskLabel[item.riskStatus]}{item.lastException?<><br/><span title={item.lastException}>最近异常：{item.lastException}</span></>:null}</td><td>{time(item.lastCheckedAt)}<br/>凭据验证：{time(item.lastVerifiedAt)}</td><td>{item.authorizedProjects.length?item.authorizedProjects.map((project)=><div key={project.id}>{project.name}</div>):"尚未授权项目"}</td><td>{operationModeLabel[item.operationMode]}<br/>{item.pendingTaskCount} 项待处理 / {item.failedTaskCount} 项失败</td></tr>)}</tbody></table></div>}
  </>;
}
