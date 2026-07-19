"use client";

import { useAsyncData } from "@/components/runtime";
import { displayDate, isAuditEmpty, listOpsAudit, OpsAsyncView, OpsPageHeader, opsPageStyles, toSafeOpsAuditRow } from "@/components/ops-runtime";
import type { AuditEventViewV1 } from "@/runtime/api-contracts";

export default function OpsAuditPage(){
  const {state}=useAsyncData<readonly AuditEventViewV1[]>(()=>listOpsAudit({limit:200}),{isEmpty:isAuditEmpty});
  return <><OpsPageHeader title="审计中心" description="查看经过权限校验的业务操作记录。页面不展示内部编号、凭证或秘密信息。"/><OpsAsyncView state={state} empty={<section className={opsPageStyles.state}><strong>暂无审计记录</strong><span>当前没有可展示的业务操作。</span></section>}>{(events)=><section className={opsPageStyles.panel}><div className={opsPageStyles.tableWrap}><table className={opsPageStyles.table}><thead><tr><th>时间</th><th>业务动作</th><th>对象</th><th>操作人员</th></tr></thead><tbody>{events.map((event)=>{const row=toSafeOpsAuditRow(event);return <tr key={event.id}><td>{displayDate(row.occurredAt)}</td><td>{row.action}</td><td>{row.targetLabel}</td><td>{row.actorLabel}</td></tr>;})}</tbody></table></div></section>}</OpsAsyncView></>;
}
