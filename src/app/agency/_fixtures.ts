/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * reconstruction_source: docs/architecture/SYSTEM_BLUEPRINT_V1.md ("Workspace surfaces:
 *   client workspace, agency workspace, ops console"), docs/architecture/
 *   MULTI_TENANT_ACCOUNT_MODEL_V1.md (AGENCY organization type, "An AGENCY user manages
 *   multiple CLIENT organizations, but only ones it has been explicitly granted access to
 *   (explicit assignment, not implicit/wildcard access)"), docs/governance/
 *   SYSTEM_INVARIANTS_V1.md ("Tenant isolation", "Publication"),
 *   recovered/partial-source/00040000000C9C607C9A7F12-page.tsx (AssignmentForm,
 *   "只有有效分配中的客户可被代理商选择" - only clients within an active assignment can
 *   be selected by an agency), recovered/partial-source/00040000000C9C661E8C211C-page.tsx
 *   (AgencyClientCreateForm, "客户将自动分配给当前代理商")
 * reconstruction_reason: no original page/fixture code recoverable beyond the 7 files
 *   already in recovered/partial-source/
 * original_file_unavailable: true
 *
 * Checkpoint C3 fixture data for the AGENCY workspace surfaces (/agency/*). Plain
 * in-memory arrays/objects only - no database, no real customer data, no network calls.
 * View-model types below follow the same client-facing-copy conventions established in
 * src/app/app/_fixtures.ts: short human-readable reference codes (never raw UUIDs), no
 * AI/model provider or vendor name, no internal production-pipeline vocabulary.
 *
 * Updated during REBUILD_INTEGRATION_ACCEPTANCE_V1's canonical contract unification
 * (docs/acceptance/CANONICAL_CONTRACT_UNIFICATION.md): this file used to redeclare
 * `AgencyClientAssignmentStatus` and a narrowed `AgencyTeamRole` locally because this
 * lane's branch could not import across branches at the time. Both now import the
 * canonical tenancy types directly.
 */
import type { AgencyClientAssignmentStatus, PlatformRole } from "@/contracts/tenancy/entities";

// ---------------------------------------------------------------------------
// Agency-acting-for-client context (drives the shared AgencyActingBanner).
//
// TODO(rebuild/tenancy-auth): once the future AuthorizationContext exists, this must
// come from the signed-in session's resolved acting-for-client identity, gated on a
// real ACTIVE AgencyClientAssignment row - not from fixture data. This checkpoint is
// presentation-only.
// ---------------------------------------------------------------------------

export interface AgencyActingContextView {
  readonly actingForClientOrgName: string;
  readonly actingForClientReferenceCode: string;
}

export const AGENCY_ACTING_CONTEXT: AgencyActingContextView = {
  actingForClientOrgName: "示例客户企业",
  actingForClientReferenceCode: "CLI-0002",
};

// ---------------------------------------------------------------------------
// 客户项目 (client projects) - only ACTIVE-assignment clients are ever visible.
// ---------------------------------------------------------------------------

export interface AgencyClientAssignmentView {
  readonly clientReferenceCode: string;
  readonly clientOrgName: string;
  readonly status: AgencyClientAssignmentStatus;
  readonly assignedLabel: string;
}

/**
 * Fixture mirrors the recovered AssignmentForm evidence rule (00040000000C9C607C9A7F12
 * -page.tsx): "只有有效分配中的客户可被代理商选择" - only clients within an ACTIVE
 * assignment can be selected/shown to an agency. Deliberately includes one REVOKED row
 * so AGENCY_VISIBLE_CLIENT_PROJECTS below can be shown, by construction rather than by
 * trust, to exclude it - no client outside this list's ACTIVE rows is reachable from
 * any C3 page.
 */
export const AGENCY_CLIENT_ASSIGNMENTS: readonly AgencyClientAssignmentView[] = [
  {
    clientReferenceCode: "CLI-0002",
    clientOrgName: "示例客户企业",
    status: "ACTIVE",
    assignedLabel: "分配于 2026-05-12",
  },
  {
    clientReferenceCode: "CLI-0007",
    clientOrgName: "示例制造企业",
    status: "ACTIVE",
    assignedLabel: "分配于 2026-06-01",
  },
  {
    clientReferenceCode: "CLI-0011",
    clientOrgName: "示例零售企业（历史客户）",
    status: "REVOKED",
    assignedLabel: "分配已于 2026-04-20 撤销",
  },
] as const;

export interface AgencyClientProjectView {
  readonly referenceCode: string;
  readonly name: string;
  readonly stageLabel: string;
  readonly updatedLabel: string;
}

export interface AgencyClientWithProjectsView {
  readonly clientReferenceCode: string;
  readonly clientOrgName: string;
  readonly projects: readonly AgencyClientProjectView[];
}

const CLIENT_PROJECTS_BY_REFERENCE: Readonly<Record<string, readonly AgencyClientProjectView[]>> = {
  "CLI-0002": [
    { referenceCode: "PRJ-0007", name: "示例客户项目", stageLabel: "内容撰写中", updatedLabel: "2026-07-17" },
  ],
  "CLI-0007": [
    { referenceCode: "PRJ-0014", name: "制造行业知识库项目", stageLabel: "关键词映射中", updatedLabel: "2026-07-15" },
    { referenceCode: "PRJ-0015", name: "制造行业交付项目", stageLabel: "待交付确认", updatedLabel: "2026-07-16" },
  ],
  // Deliberately no entry keyed by "CLI-0011" (the REVOKED assignment above). Even if
  // one were added here it could not surface: AGENCY_VISIBLE_CLIENT_PROJECTS below is
  // built only from ACTIVE assignment rows.
};

/**
 * The only client/project list any C3 page is allowed to read from. Built by filtering
 * AGENCY_CLIENT_ASSIGNMENTS to status === "ACTIVE", so a client with a REVOKED (or any
 * non-ACTIVE) assignment can never appear here - matching SYSTEM_INVARIANTS_V1 "Tenant
 * isolation" ("An AGENCY user may only act on CLIENT organizations it has an explicit,
 * active assignment to - no implicit or wildcard access").
 */
export const AGENCY_VISIBLE_CLIENT_PROJECTS: readonly AgencyClientWithProjectsView[] = AGENCY_CLIENT_ASSIGNMENTS.filter(
  (assignment) => assignment.status === "ACTIVE",
).map((assignment) => ({
  clientReferenceCode: assignment.clientReferenceCode,
  clientOrgName: assignment.clientOrgName,
  projects: CLIENT_PROJECTS_BY_REFERENCE[assignment.clientReferenceCode] ?? [],
}));

// ---------------------------------------------------------------------------
// 行业模板 (industry templates)
// ---------------------------------------------------------------------------

export interface IndustryTemplateView {
  readonly referenceCode: string;
  readonly name: string;
  readonly industryLabel: string;
  readonly summary: string;
  readonly updatedLabel: string;
}

export const INDUSTRY_TEMPLATES: readonly IndustryTemplateView[] = [
  {
    referenceCode: "TPL-0004",
    name: "制造业知识库模板",
    industryLabel: "制造业",
    summary: "面向制造企业的知识条目结构与关键词分类模板。",
    updatedLabel: "2026-06-20",
  },
  {
    referenceCode: "TPL-0009",
    name: "零售业内容模板",
    industryLabel: "零售业",
    summary: "面向零售企业的内容分类与常见问题模板。",
    updatedLabel: "2026-06-25",
  },
  {
    referenceCode: "TPL-0012",
    name: "专业服务业模板",
    industryLabel: "专业服务业",
    summary: "面向咨询、法律等专业服务企业的内容结构模板。",
    updatedLabel: "2026-07-02",
  },
] as const;

// ---------------------------------------------------------------------------
// 批量任务 (batch tasks) - status display only, no real job execution.
// ---------------------------------------------------------------------------

export interface BatchTaskView {
  readonly referenceCode: string;
  readonly name: string;
  readonly statusLabel: string;
  readonly itemCount: number;
  readonly progressLabel: string;
}

export const BATCH_TASKS: readonly BatchTaskView[] = [
  {
    referenceCode: "BTH-0031",
    name: "制造行业客户关键词批量导入",
    statusLabel: "待执行",
    itemCount: 42,
    progressLabel: "0 / 42 已处理",
  },
  {
    referenceCode: "BTH-0032",
    name: "零售行业客户内容批量校对",
    statusLabel: "已暂停",
    itemCount: 18,
    progressLabel: "6 / 18 已处理",
  },
] as const;

export const BATCH_TASK_NOTICE = "占位数据 - 本页面不触发任何真实批量任务执行，仅展示任务状态列表。";

// ---------------------------------------------------------------------------
// 审核队列 (review queue) - presentation only, no real approve/reject action wired.
// ---------------------------------------------------------------------------

export interface ReviewQueueItemView {
  readonly referenceCode: string;
  readonly title: string;
  readonly clientOrgName: string;
  readonly submittedLabel: string;
  readonly statusLabel: string;
}

export const REVIEW_QUEUE_ITEMS: readonly ReviewQueueItemView[] = [
  {
    referenceCode: "RVW-0021",
    title: "示例客户项目内容审核",
    clientOrgName: "示例客户企业",
    submittedLabel: "2026-07-16 提交",
    statusLabel: "待审核",
  },
  {
    referenceCode: "RVW-0022",
    title: "制造行业知识库条目审核",
    clientOrgName: "示例制造企业",
    submittedLabel: "2026-07-17 提交",
    statusLabel: "待审核",
  },
] as const;

export const REVIEW_QUEUE_NOTICE = "占位数据 - 本页面为审核队列展示，不执行任何真实的通过/驳回操作，无表单提交。";

// ---------------------------------------------------------------------------
// 交付包 (delivery packages) - 0 auto-published, same rule as the client workspace's
// delivery center (src/app/app/_fixtures.ts DELIVERY_ITEMS / DELIVERY_CHANNEL_NOTICE).
// ---------------------------------------------------------------------------

export interface AgencyDeliveryPackageView {
  readonly referenceCode: string;
  readonly title: string;
  readonly clientOrgName: string;
  readonly statusLabel: string;
  readonly autoPublishedCount: 0;
}

export const AGENCY_DELIVERY_PACKAGES: readonly AgencyDeliveryPackageView[] = [
  {
    referenceCode: "PKG-0041",
    title: "示例客户项目交付包",
    clientOrgName: "示例客户企业",
    statusLabel: "待客户确认",
    autoPublishedCount: 0,
  },
  {
    referenceCode: "PKG-0042",
    title: "制造行业交付项目交付包",
    clientOrgName: "示例制造企业",
    statusLabel: "草拟中",
    autoPublishedCount: 0,
  },
] as const;

export const AGENCY_DELIVERY_NOTICE =
  "尚未自动发布任何交付包 - 与客户工作台交付中心一致，本清单不会自动发布到客户网站或任何平台，需人工在交付中心明确选择渠道后才能启动交付。";

// ---------------------------------------------------------------------------
// 团队与权限 (team & permissions)
// ---------------------------------------------------------------------------

/**
 * Display-only narrowing of the canonical `PlatformRole` to the two roles this page
 * ever shows. `Extract<>` over the canonical union rather than a locally-declared
 * literal union, so this stays correct (or fails to compile) if `PlatformRole` ever
 * changes upstream - it cannot silently drift into an independent duplicate.
 */
export type AgencyTeamRole = Extract<PlatformRole, "AGENCY_OWNER" | "AGENCY_OPERATOR">;

export interface AgencyTeamMemberView {
  readonly referenceCode: string;
  readonly displayName: string;
  readonly role: AgencyTeamRole;
  readonly roleLabel: string;
  readonly statusLabel: string;
}

export const AGENCY_TEAM_MEMBERS: readonly AgencyTeamMemberView[] = [
  {
    referenceCode: "USR-0101",
    displayName: "示例代理商负责人",
    role: "AGENCY_OWNER",
    roleLabel: "代理商负责人",
    statusLabel: "已启用",
  },
  {
    referenceCode: "USR-0102",
    displayName: "示例内容运营",
    role: "AGENCY_OPERATOR",
    roleLabel: "代理商操作员",
    statusLabel: "已启用",
  },
  {
    referenceCode: "USR-0103",
    displayName: "示例客户对接",
    role: "AGENCY_OPERATOR",
    roleLabel: "代理商操作员",
    statusLabel: "已停用",
  },
] as const;
