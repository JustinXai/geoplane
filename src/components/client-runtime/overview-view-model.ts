import type { ClientOverviewData } from "./endpoints.js";

export interface ClientOverviewMetricVM { readonly label:string; readonly value:string; readonly source:string; readonly href:string }
export interface ClientOverviewActivityVM { readonly label:string; readonly detail:string; readonly occurredAt:string }
export interface ClientOverviewActionVM { readonly label:string; readonly reason:string; readonly href:string }
export interface ClientOverviewGapVM { readonly priority:"P0"|"P1"; readonly title:string; readonly reason:string }
export interface ClientOverviewVM {
  readonly metrics:readonly ClientOverviewMetricVM[];
  readonly risks:readonly string[];
  readonly actions:readonly ClientOverviewActionVM[];
  readonly activities:readonly ClientOverviewActivityVM[];
  readonly confirmedQuestions:number;
  readonly pendingQuestions:number;
  readonly gaps:readonly ClientOverviewGapVM[];
}

const knowledgeStatusLabel={NOT_STARTED:"尚未建档",NEEDS_INFORMATION:"资料待补齐",READY_FOR_CONFIRMATION:"待确认",CONFIRMED:"已确认"} as const;

export function buildClientOverview(data:ClientOverviewData):ClientOverviewVM{
  const candidates=data.expansionBatches.flatMap(batch=>batch.candidates).filter(item=>item.question!==null);
  const confirmedQuestionTexts=new Set([
    ...data.keywords.flatMap(item=>item.userQuestions).map(item=>item.trim()).filter(Boolean),
    ...candidates.filter(item=>item.status==="CONFIRMED").map(item=>item.question?.trim()??"").filter(Boolean),
  ]);
  const confirmedQuestions=confirmedQuestionTexts.size;
  const pendingQuestions=candidates.filter(item=>item.status==="NEEDS_HUMAN_REVIEW").length;
  const producing=data.deliveries.filter(item=>item.status==="IN_PRODUCTION").length;
  const reviewing=data.deliveries.filter(item=>item.status==="IN_REVIEW").length;
  const delivered=data.deliveries.filter(item=>item.status==="DELIVERED").length;
  const latestDecisionByRecord=new Map<string,(typeof data.keywordData.decisions)[number]>();
  for(const decision of data.keywordData.decisions){const current=latestDecisionByRecord.get(decision.keywordRecordId);if(!current||current.decidedAt<decision.decidedAt)latestDecisionByRecord.set(decision.keywordRecordId,decision)}
  const confirmedKeywords=[...latestDecisionByRecord.values()].filter(item=>item.decision==="CONFIRMED").length;
  const pendingKeywordReview=data.keywordData.records.filter(item=>!data.keywordData.datasets.find(dataset=>dataset.id===item.datasetId)?.readOnly&&!latestDecisionByRecord.has(item.id)).length;
  const sourceCount=new Set(data.keywordData.datasets.map(item=>item.source)).size;
  const metrics:ClientOverviewMetricVM[]=[
    {label:"企业资料状态",value:knowledgeStatusLabel[data.knowledge.status],source:`来源：知识包、资料文件与未解决问题`,href:"#knowledge-progress"},
    {label:"关键词资料",value:String(data.keywordData.records.length),source:`来源：${sourceCount} 类真实数据来源`,href:"#keyword-progress"},
    {label:"已确认关键词",value:String(confirmedKeywords),source:"来源：通用关键词人工审核决定记录",href:"/app/keywords"},
    {label:"已确认用户问题",value:String(confirmedQuestions),source:"来源：已建立的问题关系与人工确认记录（去重）",href:"#question-progress"},
    {label:"待确认用户问题",value:String(pendingQuestions),source:"来源：尚未作出人工决定的用户问题",href:"#question-progress"},
    {label:"内容生产中",value:String(producing),source:"来源：已保存的内容进度记录",href:"#content-progress"},
    {label:"待审核内容",value:String(reviewing),source:"来源：已保存的内容进度记录",href:"#content-progress"},
    {label:"已完成交付",value:String(delivered),source:"来源：客户可读交付记录",href:"#content-progress"},
  ];
  const risks:string[]=[];
  if(data.knowledge.missingInformationCount>0)risks.push(`企业资料有 ${data.knowledge.missingInformationCount} 项明确缺失信息待补齐。`);
  if(data.knowledge.openIssueCount>data.knowledge.missingInformationCount)risks.push(`企业资料另有 ${data.knowledge.openIssueCount-data.knowledge.missingInformationCount} 项质量问题待处理。`);
  const rejectedRows=data.keywordData.imports.reduce((total,item)=>total+item.rejectedCount,0);
  if(rejectedRows>0)risks.push(`关键词导入记录中累计有 ${rejectedRows} 行未接收，请核对原始文件。`);
  const actions:ClientOverviewActionVM[]=[];
  if(data.knowledge.status==="NOT_STARTED"||data.knowledge.status==="NEEDS_INFORMATION")actions.push({label:"补齐企业资料",reason:data.knowledge.status==="NOT_STARTED"?"尚未建立知识包":"存在未解决的资料缺口",href:"/app/enterprise"});
  if(data.keywordData.records.length===0)actions.push({label:"补充关键词资料（可选）",reason:"可手动添加或导入通用文件；也可以跳过并直接从企业知识生成",href:"/app/keywords#keyword-input"});
  else if(pendingKeywordReview>0)actions.push({label:"确认关键词资料",reason:`有 ${pendingKeywordReview} 条可选关键词资料等待人工决定`,href:"/app/keywords"});
  if(pendingQuestions>0)actions.push({label:"确认用户问题",reason:`有 ${pendingQuestions} 个用户问题等待人工决定`,href:"/app/questions"});
  if(reviewing>0)actions.push({label:"审核内容",reason:`有 ${reviewing} 篇内容处于审核中`,href:"/app/content-review"});
  if(actions.length===0)actions.push({label:"查看内容与交付",reason:"当前没有高优先级待办，可继续核对内容进度",href:"/app/content"});
  const activities:ClientOverviewActivityVM[]=[];
  if(data.knowledge.updatedAt)activities.push({label:"企业资料更新",detail:`知识包 ${data.knowledge.packageCount} 个，资料文件 ${data.knowledge.documentCount} 份`,occurredAt:data.knowledge.updatedAt});
  const latestImport=data.keywordData.imports.map(item=>item.importedAt).sort().at(-1);
  if(latestImport)activities.push({label:"关键词资料入库",detail:`当前共 ${data.keywordData.records.length} 条，来自 ${sourceCount} 类来源`,occurredAt:latestImport});
  const latestDelivery=[...data.deliveries].filter(item=>item.deliveredAt!==null).sort((a,b)=>(a.deliveredAt??"").localeCompare(b.deliveredAt??"")).at(-1);
  if(latestDelivery?.deliveredAt)activities.push({label:"内容交付",detail:latestDelivery.title,occurredAt:latestDelivery.deliveredAt});
  activities.sort((a,b)=>b.occurredAt.localeCompare(a.occurredAt));
  return {metrics,risks,actions,activities,confirmedQuestions,pendingQuestions,gaps:[{priority:"P1",title:"客户报告记录",reason:"当前系统尚未建立独立的客户报告记录；首页只展示真实交付记录，不生成模拟报告或报告数量。"}]};
}
