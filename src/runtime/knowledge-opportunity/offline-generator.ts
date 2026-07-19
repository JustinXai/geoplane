import { createHash } from "node:crypto";
import type {
  DecisionStage,
  GenerateKnowledgeOpportunityInput,
  KnowledgeBusinessContext,
  KnowledgeOpportunityBatch,
  KnowledgeOpportunitySource,
  OptionalKeywordSeed,
  UserIntent,
  UserQuestionCandidate,
} from "./contracts.js";
import type { KnowledgeOpportunityGeneratorPort } from "./ports.js";

const MAX_CANDIDATES = 20;

function clean(value: string | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ");
}

function cleanList(values: readonly string[]): string[] {
  return [...new Set(values.map(clean).filter(Boolean))];
}

function stableId(input: GenerateKnowledgeOpportunityInput, question: string): string {
  return `kgo_${createHash("sha256")
    .update(`${input.clientOrganizationId}:${input.projectId}:${input.knowledgePackageId}:${input.knowledgePackageVersion}:${question}`)
    .digest("hex")
    .slice(0, 24)}`;
}

function hasKnowledge(context: KnowledgeBusinessContext): boolean {
  return Boolean(
    clean(context.enterpriseIntroduction) ||
      cleanList(context.productsAndServices).length ||
      cleanList(context.cases).length ||
      context.faqs.some((faq) => clean(faq.question)) ||
      cleanList(context.businessGoals).length ||
      cleanList(context.verifiableFacts).length,
  );
}

function defaultAudience(context: KnowledgeBusinessContext): string {
  return cleanList(context.targetAudiences)[0] ?? "目标客户";
}

function defaultRegion(context: KnowledgeBusinessContext): string {
  return cleanList(context.regions)[0] ?? "目标市场";
}

function defaultOffering(context: KnowledgeBusinessContext): string {
  return (
    cleanList(context.productsAndServices)[0] ??
    cleanList(context.businessGoals)[0] ??
    (clean(context.industry) || "企业的产品与服务")
  );
}

interface CandidateDraft {
  question: string;
  intent: UserIntent;
  scenario: string;
  audience: string;
  problem: string;
  decisionStage: DecisionStage;
  contentOpportunity: string;
  evidenceNeed: string[];
  source: KnowledgeOpportunitySource;
  seed?: OptionalKeywordSeed;
}

function knowledgeDrafts(context: KnowledgeBusinessContext): CandidateDraft[] {
  const audience = defaultAudience(context);
  const region = defaultRegion(context);
  const offering = defaultOffering(context);
  const differentiator = cleanList(context.differentiators)[0];
  const fact = cleanList(context.verifiableFacts)[0];
  const goal = cleanList(context.businessGoals)[0] ?? `解决${audience}的业务问题`;
  const evidenceNeed = [
    ...(fact ? [] : ["补充可验证的产品或服务事实"]),
    ...(cleanList(context.cases).length ? [] : ["补充可公开引用的客户案例"]),
  ];
  const source: KnowledgeOpportunitySource =
    cleanList(context.productsAndServices).length || fact || context.faqs.length
      ? "KNOWLEDGE_GROUNDED_OPPORTUNITY"
      : "INDUSTRY_HYPOTHESIS";

  const drafts: CandidateDraft[] = [
    {
      question: `${audience}在${region}选择${offering}时应该重点关注什么？`,
      intent: "EVALUATE",
      scenario: `${region}的${audience}正在评估解决方案`,
      audience,
      problem: goal,
      decisionStage: "CONSIDERATION",
      contentOpportunity: `${offering}选型与评估指南`,
      evidenceNeed,
      source,
    },
    {
      question: `${offering}如何帮助${audience}${goal.startsWith("解决") ? goal : `实现${goal}`}？`,
      intent: "SOLVE",
      scenario: `${audience}正在寻找可执行的解决路径`,
      audience,
      problem: goal,
      decisionStage: "AWARENESS",
      contentOpportunity: `${offering}的业务价值与适用场景`,
      evidenceNeed,
      source,
    },
  ];

  if (differentiator) {
    drafts.push({
      question: `${differentiator}与常见方案相比，适合哪些${audience}？`,
      intent: "COMPARE",
      scenario: `${audience}正在比较不同方案`,
      audience,
      problem: `判断${differentiator}是否适合当前需求`,
      decisionStage: "DECISION",
      contentOpportunity: `${differentiator}的差异化说明`,
      evidenceNeed: fact ? [] : ["补充能够证明差异化能力的事实"],
      source: "KNOWLEDGE_GROUNDED_OPPORTUNITY",
    });
  }

  for (const faq of context.faqs) {
    const question = clean(faq.question);
    if (!question) continue;
    drafts.push({
      question: /[？?]$/.test(question) ? question.replace(/\?$/, "？") : `${question}？`,
      intent: "LEARN",
      scenario: `${audience}正在确认常见疑问`,
      audience,
      problem: question,
      decisionStage: "CONSIDERATION",
      contentOpportunity: `围绕“${question}”提供清晰、可验证的回答`,
      evidenceNeed: clean(faq.answer) ? [] : ["补充该问题的企业正式回答"],
      source: "KNOWLEDGE_GROUNDED_OPPORTUNITY",
    });
  }
  return drafts;
}

function seedDraft(seed: OptionalKeywordSeed, context: KnowledgeBusinessContext): CandidateDraft {
  const text = clean(seed.text);
  const audience = defaultAudience(context);
  const offering = defaultOffering(context);
  const verifiedEvidence = (seed.evidence ?? []).filter((item) => item.verified === true);
  return {
    question: `${audience}搜索“${text}”时，通常需要了解哪些与${offering}相关的问题？`,
    intent: "LEARN",
    scenario: `${audience}以“${text}”作为信息检索入口`,
    audience,
    problem: `理解“${text}”背后的真实业务问题`,
    decisionStage: "AWARENESS",
    contentOpportunity: `结合企业知识解释“${text}”及其适用场景`,
    evidenceNeed: verifiedEvidence.length ? [] : ["需要进一步确认该关键词对应的真实需求"],
    source: "KNOWLEDGE_GROUNDED_OPPORTUNITY",
    seed: { ...seed, text, evidence: verifiedEvidence },
  };
}

export class DeterministicKnowledgeOpportunityGenerator
  implements KnowledgeOpportunityGeneratorPort
{
  generate(input: GenerateKnowledgeOpportunityInput): KnowledgeOpportunityBatch {
    if (!input.clientOrganizationId || !input.projectId || !input.knowledgePackageId) {
      throw new Error("knowledge opportunity scope is required");
    }
    if (!Number.isInteger(input.knowledgePackageVersion) || input.knowledgePackageVersion < 1) {
      throw new Error("knowledge package version must be a positive integer");
    }
    if (!hasKnowledge(input.context)) {
      throw new Error("knowledge package must contain usable business context");
    }

    const seeds = (input.optionalKeywordSeeds ?? [])
      .filter((seed) => clean(seed.text))
      .map((seed) => ({ ...seed, text: clean(seed.text) }));
    const drafts = [...knowledgeDrafts(input.context), ...seeds.map((seed) => seedDraft(seed, input.context))];
    const byQuestion = new Map<string, CandidateDraft>();
    for (const draft of drafts) byQuestion.set(draft.question, draft);

    const candidates = [...byQuestion.values()].slice(0, MAX_CANDIDATES).map((draft): UserQuestionCandidate => {
      const seed = draft.seed;
      return {
        id: stableId(input, draft.question),
        clientOrganizationId: input.clientOrganizationId,
        projectId: input.projectId,
        knowledgePackageId: input.knowledgePackageId,
        knowledgePackageVersion: input.knowledgePackageVersion,
        question: draft.question,
        intent: draft.intent,
        scenario: draft.scenario,
        audience: draft.audience,
        problem: draft.problem,
        decisionStage: draft.decisionStage,
        contentOpportunity: draft.contentOpportunity,
        evidenceNeed: draft.evidenceNeed,
        contentConstraints: cleanList(input.context.forbiddenExpressions).map(
          (expression) => `不得使用“${expression}”`,
        ),
        source: draft.source,
        demandClaim: "NOT_ASSERTED",
        ...(seed
          ? {
              seed: {
                text: seed.text,
                origin: seed.origin,
                ...(seed.sourceRef ? { sourceRef: seed.sourceRef } : {}),
                verifiedEvidence: (seed.evidence ?? []).filter((item) => item.verified === true),
              },
            }
          : {}),
      };
    });
    return {
      knowledgePackageId: input.knowledgePackageId,
      knowledgePackageVersion: input.knowledgePackageVersion,
      candidates,
    };
  }
}
