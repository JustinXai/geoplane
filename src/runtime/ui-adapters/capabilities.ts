import { backendCapabilityGap, type BackendCapabilityGap } from "./chinese-errors.js";

export type UiCapabilityState="AVAILABLE"|"BACKEND_CAPABILITY_GAP";
export interface UiCapability {readonly key:string;readonly label:string;readonly state:UiCapabilityState;readonly route?:string;readonly gap?:BackendCapabilityGap}
const available=(key:string,label:string,route:string):UiCapability=>({key,label,state:"AVAILABLE",route});
const gap=(key:string,label:string):UiCapability=>({key,label,state:"BACKEND_CAPABILITY_GAP",gap:backendCapabilityGap(label)});

/** Auditable mapping: only AVAILABLE entries may render an enabled action. */
export const DOMESTIC_GEO_UI_CAPABILITIES:readonly UiCapability[]=Object.freeze([
  available("account.read","查看账号中心","GET /api/accounts"),
  available("account.register","登记账号","POST /api/accounts REGISTER"),
  available("account.authorize","登记账号授权","POST /api/accounts AUTHORIZE"),
  available("account.assign","分配项目账号","POST /api/accounts ASSIGN"),
  available("account.operation","登记受控操作","POST /api/accounts CREATE_OPERATION / RECORD_RESULT"),
  gap("account.revoke","撤销账号授权"),
  gap("account.credential-ui","在页面配置账号凭证"),
  available("baidu.import","导入百度关键词文件","POST /api/keywords/imports"),
  available("baidu.read","查看百度真实需求数据","GET /api/keywords/projects/:projectId/overview"),
  available("baidu.review","整理关键词组并记录人工决定","POST /api/keywords/family-drafts + review-packages + decisions"),
  gap("baidu.duplicate-history","查看历史导入批次重复数量"),
  gap("baidu.bid","查看百度推荐出价"),gap("baidu.competition","查看百度竞争度"),gap("baidu.region","查看百度地域维度"),
  available("expansion.preview","生成离线拓词预览","POST /api/keyword-expansion/preview"),
  available("expansion.review","人工确认或删除拓词","POST /api/keyword-expansion/candidates/:id/:decision"),
  available("expansion.read","查看拓词批次","GET /api/keyword-expansion/projects/:projectId"),
  available("questions.read","查看用户问题","GET /api/projects/:projectId/keyword-questions"),
  available("probe.options","获取人工查询可选项目和问题","GET /api/probes/options"),
  available("probe.record","登记人工查询样本","POST /api/probes/manual-samples"),
  available("probe.read","查看人工查询样本","GET /api/probes/projects/:projectId/manual-samples"),
  gap("probe.annotations","持久化品牌与竞品人工标注"),gap("probe.report-metrics","读取持久化效果指标报告"),
  available("policy.read","查看项目行业规则包","GET /api/policy-packs/projects/:projectId"),
  gap("policy.select","在页面切换行业规则包"),
  available("agency.portfolio","查看代理商交付总览","GET /api/agency-delivery/portfolio"),
  available("agency.workflow","推进代理商业务阶段","POST /api/agency-delivery/workflow"),
  available("agency.delivery","登记人工交付","POST /api/agency-delivery/deliveries"),
  available("knowledge.read","查看知识包详情与问题","GET /api/knowledge/packages/:id"),
  gap("knowledge.list","按项目查看全部知识包"),
  available("content.read","查看内容机会、审核队列与交付","GET /api/projects/:projectId/*"),
  available("content.review","提交客户人工确认","POST /api/opportunities/:id/reviews"),
]);
export function capability(key:string):UiCapability{return DOMESTIC_GEO_UI_CAPABILITIES.find(x=>x.key===key)??gap(key,"未知能力")}
