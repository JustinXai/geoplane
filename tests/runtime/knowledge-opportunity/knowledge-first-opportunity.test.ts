import { describe, expect, it } from "vitest";
import type { KnowledgeBusinessContext, KnowledgeGroundingSnapshot } from "../../../src/runtime/knowledge-opportunity/contracts.js";
import {
  DeterministicKnowledgeOpportunityGenerator,
  ExistingOpportunityConnector,
  KnowledgeFirstOpportunityService,
} from "../../../src/runtime/knowledge-opportunity/index.js";
import type { KnowledgeGroundingPort } from "../../../src/runtime/knowledge-opportunity/ports.js";
import {
  buildHarness,
  clientOwnerContext,
  ORG,
  PROJECT,
} from "../geo/fakes.js";
import { toOpportunityView } from "../../../src/runtime/geo/views.js";

const CONTEXT: KnowledgeBusinessContext = {
  enterpriseIntroduction: "华东智造为工业企业提供设备预测性维护服务。",
  productsAndServices: ["设备预测性维护平台", "现场诊断服务"],
  cases: ["某零部件工厂减少了非计划停机时间。"],
  faqs: [
    {
      question: "部署预测性维护需要改造现有设备吗",
      answer: "可通过边缘采集适配现有设备。",
    },
  ],
  targetAudiences: ["工厂设备负责人"],
  regions: ["长三角"],
  businessGoals: ["降低非计划停机风险"],
  differentiators: ["兼容存量设备"],
  forbiddenExpressions: ["保证零故障"],
  verifiableFacts: ["支持边缘采集接入"],
  industry: "工业设备运维",
};

function input(optionalKeywordSeeds: Parameters<DeterministicKnowledgeOpportunityGenerator["generate"]>[0]["optionalKeywordSeeds"] = []) {
  return {
    clientOrganizationId: ORG,
    projectId: PROJECT,
    knowledgePackageId: "kp_knowledge",
    knowledgePackageVersion: 1,
    context: CONTEXT,
    optionalKeywordSeeds,
  } as const;
}

describe("knowledge-first opportunity — three legal input modes", () => {
  const generator = new DeterministicKnowledgeOpportunityGenerator();

  it("creates user-question and GEO opportunity candidates with no keyword dataset", () => {
    const batch = generator.generate(input());

    expect(batch.candidates.length).toBeGreaterThan(0);
    expect(batch.candidates.some((candidate) => candidate.question.includes("设备预测性维护"))).toBe(true);
    for (const candidate of batch.candidates) {
      expect(candidate.seed).toBeUndefined();
      expect(candidate.demandClaim).toBe("NOT_ASSERTED");
      expect(["KNOWLEDGE_GROUNDED_OPPORTUNITY", "INDUSTRY_HYPOTHESIS"]).toContain(candidate.source);
      expect(candidate).toMatchObject({
        intent: expect.any(String),
        scenario: expect.any(String),
        audience: expect.any(String),
        problem: expect.any(String),
        decisionStage: expect.any(String),
        contentOpportunity: expect.any(String),
        evidenceNeed: expect.any(Array),
        contentConstraints: ["不得使用"保证零故障""],
      });
    }
    expect(JSON.stringify(batch)).not.toContain("CONFIRMED_DEMAND");
  });

  it("uses manual keywords only as enhancement seeds and invents no demand evidence", () => {
    const batch = generator.generate(
      input([{ text: "工厂设备故障预警", origin: "MANUAL" }]),
    );
    const enhanced = batch.candidates.find((candidate) => candidate.seed?.text === "工厂设备故障预警");

    expect(enhanced).toBeDefined();
    expect(enhanced?.seed?.origin).toBe("MANUAL");
    expect(enhanced?.seed?.verifiedEvidence).toEqual([]);
    expect(enhanced?.evidenceNeed).toContain("需要进一步确认该关键词对应的真实需求");
    expect(enhanced?.demandClaim).toBe("NOT_ASSERTED");
    expect(JSON.stringify(enhanced)).not.toMatch(/searchVolume|bid|competition|baidu/i);
  });

  it("accepts a generic dataset without any Baidu-specific field and preserves only verified evidence", () => {
    const batch = generator.generate(
      input([
        {
          text: "预测性维护方案",
          origin: "DATASET",
          sourceRef: "generic-file:batch-17",
          evidence: [
            {
              field: "customer_inquiry_count",
              value: 12,
              sourceLabel: "客户历史咨询导出",
              observedAt: "2026-06-30",
              verified: true,
            },
          ],
        },
      ]),
    );
    const enhanced = batch.candidates.find((candidate) => candidate.seed?.text === "预测性维护方案");

    expect(enhanced?.seed).toEqual({
      text: "预测性维护方案",
      origin: "DATASET",
      sourceRef: "generic-file:batch-17",
      verifiedEvidence: [
        {
          field: "customer_inquiry_count",
          value: 12,
          sourceLabel: "客户历史咨询导出",
          observedAt: "2026-06-30",
          verified: true,
        },
      ],
    });
    expect(enhanced?.demandClaim).toBe("NOT_ASSERTED");
    expect(JSON.stringify(enhanced)).not.toMatch(/baidu|需求指数/i);
  });
});

describe("knowledge-first application boundary", () => {
  it("loads tenant-scoped knowledge and denies a cross-tenant actor", async () => {
    const snapshot: KnowledgeGroundingSnapshot = {
      ...input(),
    };
    let loadCount = 0;
    const port: KnowledgeGroundingPort = {
      async load() {
        loadCount += 1;
        return snapshot;
      },
    };
    const service = new KnowledgeFirstOpportunityService(
      port,
      new DeterministicKnowledgeOpportunityGenerator(),
    );

    const own = await service.generateForProject(clientOwnerContext(ORG), {
      clientOrganizationId: ORG,
      projectId: PROJECT,
      knowledgePackageId: snapshot.knowledgePackageId,
    });
    expect(own.candidates.length).toBeGreaterThan(0);
    await expect(
      service.generateForProject(clientOwnerContext("other_org"), {
        clientOrganizationId: ORG,
        projectId: PROJECT,
        knowledgePackageId: snapshot.knowledgePackageId,
      }),
    ).rejects.toThrow();
    expect(loadCount).toBe(1);
  });

  it("connects a no-keyword candidate to the existing Opportunity services without asserting demand", async () => {
    const harness = buildHarness("knowledge_first");
    const actor = clientOwnerContext(ORG);
    const knowledgePackage = await harness.keywordQuestion.createKnowledgePackage(actor, {
      clientOrganizationId: ORG,
      projectId: PROJECT,
      version: 1,
      title: "企业知识库",
      sourceDescription: "已确认企业资料",
    });
    const industry = await harness.keywordQuestion.createIndustryProfile(actor, {
      clientOrganizationId: ORG,
      projectId: PROJECT,
      verticalSlug: "industrial-maintenance",
      verticalLabel: "工业设备运维",
      validationGateLevel: "INDUSTRY_VERTICAL_GATE",
      ruleSetVersion: 1,
    });
    const candidate = new DeterministicKnowledgeOpportunityGenerator().generate({
      ...input(),
      knowledgePackageId: knowledgePackage.id,
      knowledgePackageVersion: knowledgePackage.version,
    }).candidates[0]!;
    expect(candidate.seed).toBeUndefined();

    const connector = new ExistingOpportunityConnector(
      harness.keywordQuestion,
      harness.opportunity,
    );
    await expect(
      connector.create(clientOwnerContext("other_org"), {
        candidate,
        knowledgePackage,
        industryProfileId: industry.id,
      }),
    ).rejects.toThrow();
    const connected = await connector.create(actor, {
      candidate,
      knowledgePackage,
      industryProfileId: industry.id,
    });

    expect(connected.keywordQuestionMap.entries).toEqual([
      { keyword: candidate.contentOpportunity, questions: [candidate.question] },
    ]);
    expect(connected.opportunity).toMatchObject({
      clientOrganizationId: ORG,
      projectId: PROJECT,
      groundingKnowledgePackageId: knowledgePackage.id,
      groundingKnowledgePackageVersion: knowledgePackage.version,
      keyword: candidate.contentOpportunity,
    });
    const view = toOpportunityView(connected.opportunity, "PROPOSED");
    expect(view.title).toBe(candidate.contentOpportunity);
    expect(view.summary).toBe(
      `基于企业知识库整理的内容方向：${candidate.contentOpportunity}。确认后可进入内容生产与交付流程。`,
    );
    expect(`${view.title} ${view.summary}`).not.toContain("关键词需求");
    expect(`${view.title} ${view.summary}`).not.toContain("Knowledge-grounded content opportunity");
    expect(`${view.title} ${view.summary}`).not.toMatch(/for the keyword/i);
    expect(candidate.demandClaim).toBe("NOT_ASSERTED");
  });
});
