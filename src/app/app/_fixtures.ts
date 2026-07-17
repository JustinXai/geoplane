/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * reconstruction_source: docs/architecture/SYSTEM_BLUEPRINT_V1.md (business core:
 *   "1. Enterprise knowledge base 2. Keyword and user-question mapping 3. Content and
 *   source grounding 4. Client delivery" + post-delivery "performance validation"),
 *   docs/governance/SYSTEM_INVARIANTS_V1.md ("Publication" - platform-neutral, no
 *   automatic publication, no default distribution target)
 * reconstruction_reason: no original page code recoverable beyond the 7 files already
 *   in recovered/partial-source/
 * original_file_unavailable: true
 *
 * Checkpoint C2 fixture data for the CLIENT workspace surfaces (/app/*). Plain
 * in-memory arrays/objects only - no database, no real customer data, no network
 * calls. View-model types below are defined locally to this lane (they intentionally
 * do NOT import from another lane's src/contracts) and are deliberately shaped to
 * avoid ever surfacing internal implementation detail to a client-facing screen:
 *
 * - every identifier is a short human-readable reference code (e.g. "KB-0142"),
 *   never a raw UUID or database primary key
 * - no AI/model provider or vendor name ever appears in a display string
 * - no internal production-pipeline vocabulary ("candidate", "brief", "artifact",
 *   "compiler", etc. - see docs/rebuild/recovered-evidence/TARGET_STATE_MANIFEST.md
 *   for the internal names this project actually used, e.g. ArticleBriefCandidateV1)
 *   is used in a display string - only plain client-facing language
 *
 * tests/client-workspace-copy.test.ts asserts this file's display strings hold to
 * those rules.
 */

export interface ActiveProjectView {
  readonly referenceCode: string;
  readonly name: string;
  readonly clientOrgName: string;
  readonly updatedLabel: string;
  readonly stageSummary: readonly { readonly label: string; readonly count: number }[];
}

export const ACTIVE_PROJECT: ActiveProjectView = {
  referenceCode: "PRJ-0007",
  name: "示例客户项目",
  clientOrgName: "示例企业有限公司",
  updatedLabel: "2026年7月17日更新",
  stageSummary: [
    { label: "知识条目", count: 24 },
    { label: "关键词与问题", count: 58 },
    { label: "内容条目", count: 12 },
    { label: "待交付", count: 3 },
  ],
};

/** Local view-model for a knowledge-base list/detail item (fixture-shaped, this lane only). */
export interface KnowledgePackageView {
  readonly referenceCode: string;
  readonly title: string;
  readonly category: string;
  readonly summary: string;
  readonly detail: string;
  readonly updatedLabel: string;
  readonly sourceCount: number;
}

export const KNOWLEDGE_PACKAGES: readonly KnowledgePackageView[] = [
  {
    referenceCode: "KB-0142",
    title: "产品功能总览",
    category: "产品知识",
    summary: "核心功能模块与适用场景说明，供内容撰写与客户问答引用。",
    detail:
      "涵盖产品的主要功能模块、典型使用场景与差异化能力说明。用于保证对外内容在功能描述上的准确性与一致性。",
    updatedLabel: "2026-07-10",
    sourceCount: 5,
  },
  {
    referenceCode: "KB-0158",
    title: "行业术语与常见问题",
    category: "行业知识",
    summary: "客户所在行业的常用术语解释与高频问题整理。",
    detail:
      "整理客户所在行业的专业术语、常见误解与高频客户问题，作为关键词与问题映射阶段的基础素材。",
    updatedLabel: "2026-07-08",
    sourceCount: 8,
  },
  {
    referenceCode: "KB-0163",
    title: "品牌语调与用词规范",
    category: "品牌规范",
    summary: "对外内容的语气、禁用词与格式规范。",
    detail:
      "规定对外发布内容应遵循的语气基调、禁用或慎用词汇、格式与排版规范，供内容撰写与审校阶段统一执行。",
    updatedLabel: "2026-06-30",
    sourceCount: 3,
  },
] as const;

/** Local view-model for a keyword/user-question mapping row (fixture-shaped, this lane only). */
export interface KeywordQuestionView {
  readonly referenceCode: string;
  readonly keyword: string;
  readonly intentLabel: string;
  readonly priorityLabel: "高" | "中" | "低";
  readonly relatedQuestions: readonly string[];
}

export const KEYWORD_QUESTION_ITEMS: readonly KeywordQuestionView[] = [
  {
    referenceCode: "KW-0007",
    keyword: "企业知识库如何搭建",
    intentLabel: "了解型",
    priorityLabel: "高",
    relatedQuestions: [
      "企业知识库需要哪些前期准备？",
      "知识库内容多久更新一次比较合适？",
    ],
  },
  {
    referenceCode: "KW-0013",
    keyword: "内容与信源如何对应",
    intentLabel: "对比型",
    priorityLabel: "中",
    relatedQuestions: ["对外内容如何保证有据可查？"],
  },
  {
    referenceCode: "KW-0021",
    keyword: "交付节奏如何安排",
    intentLabel: "决策型",
    priorityLabel: "中",
    relatedQuestions: [
      "内容交付的验收标准是什么？",
      "交付后多久可以看到效果？",
    ],
  },
] as const;

/** Local view-model for a content & sourcing row (fixture-shaped, this lane only). */
export interface ContentSourcingItemView {
  readonly referenceCode: string;
  readonly title: string;
  readonly stageLabel: string;
  readonly sourceSummary: string;
}

export const CONTENT_SOURCING_ITEMS: readonly ContentSourcingItemView[] = [
  {
    referenceCode: "CT-0031",
    title: "企业知识库搭建指南",
    stageLabel: "撰写中",
    sourceSummary: "关联知识条目 2 条，行业问题 1 条。",
  },
  {
    referenceCode: "CT-0032",
    title: "常见问题解答：内容与信源",
    stageLabel: "待审校",
    sourceSummary: "关联知识条目 1 条，行业问题 1 条。",
  },
  {
    referenceCode: "CT-0033",
    title: "交付节奏与验收说明",
    stageLabel: "已完成",
    sourceSummary: "关联知识条目 3 条，行业问题 2 条。",
  },
] as const;

/**
 * Local view-model for a delivery-center row. `selectedChannelCount` must always be
 * `0` in fixture data - per SYSTEM_INVARIANTS_V1 "Publication", nothing may default
 * to any distribution channel/target. Selecting a channel is an explicit action the
 * UI copy calls out, never a default.
 */
export interface DeliveryItemView {
  readonly referenceCode: string;
  readonly title: string;
  readonly statusLabel: string;
  readonly readyLabel: string;
  readonly selectedChannelCount: 0;
}

export const DELIVERY_ITEMS: readonly DeliveryItemView[] = [
  {
    referenceCode: "DLV-0011",
    title: "企业知识库搭建指南",
    statusLabel: "待客户确认",
    readyLabel: "2026-07-16 完成内容准备",
    selectedChannelCount: 0,
  },
  {
    referenceCode: "DLV-0012",
    title: "常见问题解答：内容与信源",
    statusLabel: "草拟中",
    readyLabel: "预计 2026-07-20 可交付",
    selectedChannelCount: 0,
  },
] as const;

export const DELIVERY_CHANNEL_NOTICE =
  "尚未选择任何分发渠道 - 交付内容不会自动发布到客户网站或任何平台，需人工在此明确选择渠道后才能启动交付。";

/**
 * Checkpoint C5: client-confirmation view-model (keyword confirmation, content-direction
 * confirmation, source-type confirmation) re-exported here for discoverability alongside
 * the other view-models in this file. Defined in ./_confirmation.ts - see that file's
 * header for the full provenance note and the reason this stays a local three-state type
 * instead of importing `ClientReviewDecision` from the separate, not-yet-merged
 * rebuild/tenancy-auth branch.
 */
export {
  CLIENT_CONFIRMATION_DECISIONS,
  CLIENT_CONFIRMATION_LABELS,
  NOT_YET_REVIEWED,
  applyClientConfirmationDecision,
  createInitialConfirmationState,
  type ClientConfirmationDecision,
  type ClientConfirmationState,
} from "./_confirmation";

/**
 * Collects every human-visible display string this checkpoint renders, so the
 * compliance test (tests/client-workspace-copy.test.ts) can pattern-check them
 * without needing a full render pipeline.
 */
export function collectClientVisibleStrings(): string[] {
  const strings: string[] = [
    ACTIVE_PROJECT.referenceCode,
    ACTIVE_PROJECT.name,
    ACTIVE_PROJECT.clientOrgName,
    ACTIVE_PROJECT.updatedLabel,
    DELIVERY_CHANNEL_NOTICE,
  ];

  for (const s of ACTIVE_PROJECT.stageSummary) {
    strings.push(s.label);
  }

  for (const item of KNOWLEDGE_PACKAGES) {
    strings.push(
      item.referenceCode,
      item.title,
      item.category,
      item.summary,
      item.detail,
      item.updatedLabel,
    );
  }

  for (const item of KEYWORD_QUESTION_ITEMS) {
    strings.push(item.referenceCode, item.keyword, item.intentLabel, item.priorityLabel, ...item.relatedQuestions);
  }

  for (const item of CONTENT_SOURCING_ITEMS) {
    strings.push(item.referenceCode, item.title, item.stageLabel, item.sourceSummary);
  }

  for (const item of DELIVERY_ITEMS) {
    strings.push(item.referenceCode, item.title, item.statusLabel, item.readyLabel);
  }

  return strings;
}
