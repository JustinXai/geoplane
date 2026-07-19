import { describe,expect,it } from "vitest";
import type { ClientOverviewData } from "../../../src/components/client-runtime/endpoints.js";
import { buildClientOverview } from "../../../src/components/client-runtime/overview-view-model.js";

const base:ClientOverviewData={
  project:{id:"p",name:"项目",clientOrganizationId:"c",clientOrganizationName:"企业",createdAt:"2026-07-01T00:00:00.000Z"},
  keywords:[],opportunities:[],deliveries:[],
  knowledge:{packageCount:1,confirmedPackageCount:0,documentCount:2,openIssueCount:2,missingInformationCount:1,status:"NEEDS_INFORMATION",updatedAt:"2026-07-18T01:00:00.000Z"},
  baidu:{imports:[],keywords:[],reviewFamilies:[],totals:{imports:0,keywords:0,withObservedDemand:0,rejectedRows:0,pendingReview:0,confirmed:0,changesRequested:0,rejected:0},nextPackageVersion:1,capabilityGaps:[]},
  expansionBatches:[],
};

describe("客户首页验收展示模型",()=>{
  it("用可核验代理呈现资料状态，且不把百度入库冒充已确认",()=>{
    const model=buildClientOverview(base);
    expect(model.metrics.find(item=>item.label==="企业资料状态")?.value).toBe("资料待补齐");
    expect(model.metrics.find(item=>item.label==="百度关键词已入库")?.value).toBe("0");
    expect(model.metrics.some(item=>item.label.includes("已确认百度"))).toBe(false);
    expect(model.gaps).not.toContainEqual(expect.objectContaining({title:"百度关键词独立确认状态"}));
    expect(model.metrics.find(item=>item.label==="已确认关键词组")?.value).toBe("0");
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
