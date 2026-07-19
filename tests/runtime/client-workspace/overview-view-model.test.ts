import { describe,expect,it } from "vitest";
import type { ClientOverviewData } from "../../../src/components/client-runtime/endpoints.js";
import { buildClientOverview } from "../../../src/components/client-runtime/overview-view-model.js";

const base:ClientOverviewData={
  project:{id:"p",name:"项目",clientOrganizationId:"c",clientOrganizationName:"企业",createdAt:"2026-07-01T00:00:00.000Z"},
  keywords:[],opportunities:[],deliveries:[],
  knowledge:{packageCount:1,confirmedPackageCount:0,documentCount:2,openIssueCount:2,missingInformationCount:1,status:"NEEDS_INFORMATION",updatedAt:"2026-07-18T01:00:00.000Z"},
  keywordData:{projectId:"p",datasets:[],records:[],imports:[],evidence:[],reviewPackages:[],decisions:[],capabilities:{createDataset:true,manualAdd:true,genericCsvXlsxImport:true,humanReview:true,archive:true,legacyBaiduReadOnly:true}},
  expansionBatches:[],
};

describe("客户首页验收展示模型",()=>{
  it("用可核验代理呈现资料状态，并将零关键词数据集明确为可选",()=>{
    const model=buildClientOverview(base);
    expect(model.metrics.find(item=>item.label==="企业资料状态")?.value).toBe("资料待补齐");
    expect(model.metrics.find(item=>item.label==="关键词资料")?.value).toBe("0");
    expect(model.metrics.some(item=>item.label.includes("百度"))).toBe(false);
    expect(model.metrics.find(item=>item.label==="已确认关键词")?.value).toBe("0");
    expect(model.actions).toContainEqual(expect.objectContaining({label:"补充关键词资料（可选）",href:"/app/keywords#keyword-input"}));
  });

  it("按通用数据的真实来源、记录、证据和人工决定统计",()=>{
    const model=buildClientOverview({...base,keywordData:{...base.keywordData,
      datasets:[{id:"manual",name:"人工词",source:"MANUAL",status:"ACTIVE",createdAt:"2026-07-19T00:00:00Z"},{id:"history",name:"历史需求",source:"CUSTOMER_HISTORY",status:"ACTIVE",createdAt:"2026-07-19T00:00:00Z"}],
      records:[{id:"r1",datasetId:"manual",keyword:"GEO",normalizedKeyword:"geo",source:"MANUAL",createdAt:"2026-07-19T00:00:00Z"},{id:"r2",datasetId:"history",keyword:"内容增长",normalizedKeyword:"内容增长",source:"CUSTOMER_HISTORY",createdAt:"2026-07-19T00:00:00Z"}],
      imports:[{id:"i1",datasetId:"history",fileName:"history.csv",source:"CUSTOMER_HISTORY",status:"COMPLETED",acceptedCount:1,rejectedCount:0,importedAt:"2026-07-19T01:00:00Z"}],
      evidence:[{id:"e1",keywordRecordId:"r2",source:"CUSTOMER_HISTORY",metricKind:"SEARCH_COUNT",metricValue:12,sourceReference:"crm",observedAt:"2026-07-18T00:00:00Z"}],
      decisions:[{id:"d1",reviewPackageId:"p1",keywordRecordId:"r1",decision:"CONFIRMED",decidedAt:"2026-07-19T02:00:00Z"}],
    }});
    expect(model.metrics.find(item=>item.label==="关键词资料")).toMatchObject({value:"2",source:"来源：2 类真实数据来源"});
    expect(model.metrics.find(item=>item.label==="已确认关键词")?.value).toBe("1");
    expect(model.actions).toContainEqual(expect.objectContaining({label:"确认关键词资料"}));
    expect(model.activities).toContainEqual(expect.objectContaining({label:"关键词资料入库"}));
  });

  it("只把人工确认的有问题文本结果计入已确认用户问题",()=>{
    const model=buildClientOverview({...base,expansionBatches:[{id:"b",clientOrganizationId:"c",projectId:"p",version:1,status:"PREVIEW",createdAt:"2026-07-18T00:00:00.000Z",candidates:[
      {id:"1",batchId:"b",keyword:"词一",question:"问题一",reason:"整理",confidence:0.5,status:"CONFIRMED",provenance:{generator:"DETERMINISTIC_OFFLINE",generatorVersion:"1",generatedAt:"2026-07-18T00:00:00.000Z",requestedByUserId:"u",inputSnapshot:{groups:[],reason:"整理"}}},
      {id:"2",batchId:"b",keyword:"词二",question:"问题二",reason:"整理",confidence:0.5,status:"NEEDS_HUMAN_REVIEW",provenance:{generator:"DETERMINISTIC_OFFLINE",generatorVersion:"1",generatedAt:"2026-07-18T00:00:00.000Z",requestedByUserId:"u",inputSnapshot:{groups:[],reason:"整理"}}},
      {id:"3",batchId:"b",keyword:"词三",question:null,reason:"整理",confidence:0.5,status:"CONFIRMED",provenance:{generator:"DETERMINISTIC_OFFLINE",generatorVersion:"1",generatedAt:"2026-07-18T00:00:00.000Z",requestedByUserId:"u",inputSnapshot:{groups:[],reason:"整理"}}},
    ]}]});
    expect(model.confirmedQuestions).toBe(1);
    expect(model.pendingQuestions).toBe(1);
    expect(model.actions).toContainEqual(expect.objectContaining({label:"确认用户问题",href:"/app/questions"}));
  });

  it("交付时间形成最近进度且首页不依赖独立检测原型",()=>{
    const model=buildClientOverview({...base,
      deliveries:[{id:"d",projectId:"p",title:"已交付内容",status:"DELIVERED",deliveredAt:"2026-07-19T02:00:00.000Z",publicationRegisteredAt:null}],
    });
    expect(model.metrics.some(item=>item.label.includes("检测"))).toBe(false);
    expect(model.actions.some(item=>item.href==="/app/ai-results")).toBe(false);
    expect(model.activities[0]).toEqual(expect.objectContaining({label:"内容交付",detail:"已交付内容"}));
    expect(model.gaps).toContainEqual(expect.objectContaining({priority:"P1",title:"客户报告记录"}));
  });
});
