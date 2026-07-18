/**
 * CLIENT_WORKSPACE_RUNTIME_V1 (Agent D) — pure DTO -> display view-model mappers,
 * selectors and label/format helpers for the CLIENT workspace screens.
 *
 * No React import: everything here is a pure function so the data-shaping LOGIC can be
 * unit-tested without a DOM renderer (mirrors how F1 tested selectAsyncState).
 *
 * Client-surface invariant (SYSTEM_INVARIANTS_V1): the display view-models below copy
 * ONLY human-facing fields from the frozen DTOs. The stable-but-internal ids the DTOs
 * carry (userId / organizationId / projectId / packageId / issue id / delivery id, all
 * UUIDs) are NEVER read into a rendered view-model — client screens must never surface a
 * UUID / Hash / Provider / Schema / Candidate / Brief / Artifact. tests/runtime/
 * client-workspace/client-surface-leak.test.ts asserts this on the serialized VMs.
 */
import type {
  AccountViewV1,
  ArticleDeliveryStatusV1,
  ArticleDeliveryViewV1,
  KeywordQuestionViewV1,
  KnowledgeIssueKindV1,
  KnowledgeIssueSeverityV1,
  KnowledgeIssueViewV1,
  KnowledgePackageStatusV1,
  KnowledgePackageViewV1,
  OpportunityStatusV1,
  OpportunityViewV1,
  ProjectViewV1,
  WorkspaceSurfaceV1,
} from "../../runtime/api-contracts/index.js";
import type {
  OrganizationType,
  PlatformRole,
} from "../../contracts/tenancy/entities.js";

// ---------------------------------------------------------------------------
// Human-facing label maps (client copy — no internal vocabulary)
// ---------------------------------------------------------------------------

export const ROLE_LABELS: Record<PlatformRole, string> = {
  PLATFORM_SUPER_ADMIN: "平台管理员",
  AGENCY_OWNER: "代理负责人",
  AGENCY_OPERATOR: "代理运营",
  CLIENT_OWNER: "客户负责人",
};

export const ORG_TYPE_LABELS: Record<OrganizationType, string> = {
  PLATFORM: "平台",
  AGENCY: "代理机构",
  CLIENT: "客户企业",
};

export const SURFACE_LABELS: Record<WorkspaceSurfaceV1, string> = {
  client: "客户工作台",
  agency: "代理工作台",
  ops: "运营工作台",
};

export const PACKAGE_STATUS_LABELS: Record<KnowledgePackageStatusV1, string> = {
  DRAFT: "草稿",
  IN_REVIEW: "审核中",
  CONFIRMED: "已确认",
};

export const ISSUE_KIND_LABELS: Record<KnowledgeIssueKindV1, string> = {
  MISSING_INFORMATION: "信息缺失",
  UNVERIFIED_FACT: "事实待核实",
  FORBIDDEN_USAGE: "使用受限",
  CLASSIFICATION_NEEDED: "待分类",
};

export const ISSUE_SEVERITY_LABELS: Record<KnowledgeIssueSeverityV1, string> = {
  INFO: "提示",
  WARNING: "警告",
  BLOCKER: "阻断",
};

export const OPPORTUNITY_STATUS_LABELS: Record<OpportunityStatusV1, string> = {
  PROPOSED: "待评估",
  VALIDATED: "已验证",
  CONFIRMED: "已确认",
  REJECTED: "已否决",
};

export const DELIVERY_STATUS_LABELS: Record<ArticleDeliveryStatusV1, string> = {
  IN_PRODUCTION: "制作中",
  IN_REVIEW: "审核中",
  APPROVED: "已批准",
  DELIVERED: "已交付",
};

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

/** Deterministic date label: the YYYY-MM-DD prefix of an ISO string (no timezone math). */
export function formatDateLabel(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : value;
}

/** Emptiness predicate for the array-shaped list endpoints (routes return plain arrays). */
export function isEmptyArray(value: readonly unknown[]): boolean {
  return value.length === 0;
}

// ---------------------------------------------------------------------------
// Project selection (Dashboard "current-project selector" — pick the first by default)
// ---------------------------------------------------------------------------

/**
 * Resolve the active project from the list and an optional 0-based selector index.
 * Out-of-range / undefined index falls back to the first project; empty list -> null.
 * Selection is by index (never by UUID) so no internal id reaches the view layer.
 */
export function selectActiveProject(
  projects: readonly ProjectViewV1[],
  index?: number,
): ProjectViewV1 | null {
  if (projects.length === 0) return null;
  const chosen = index !== undefined ? projects[index] : undefined;
  return chosen ?? projects[0] ?? null;
}

export interface ProjectOptionVM {
  readonly index: number;
  readonly label: string;
}

/** Selector options: a 0-based index (opaque handle) + the human project name. */
export function toProjectOptions(projects: readonly ProjectViewV1[]): readonly ProjectOptionVM[] {
  return projects.map((project, index) => ({ index, label: project.name }));
}

// ---------------------------------------------------------------------------
// Display view-models (human-facing fields only)
// ---------------------------------------------------------------------------

export interface AccountSummaryVM {
  readonly greetingName: string;
  readonly organizationName: string;
  readonly organizationTypeLabel: string;
  readonly roleLabel: string;
  readonly surfaceLabel: string;
}

export function toAccountSummary(account: AccountViewV1): AccountSummaryVM {
  return {
    greetingName: account.displayName ?? account.email,
    organizationName: account.organizationName,
    organizationTypeLabel: ORG_TYPE_LABELS[account.organizationType],
    roleLabel: ROLE_LABELS[account.role],
    surfaceLabel: SURFACE_LABELS[account.surface],
  };
}

export interface ProjectSummaryVM {
  readonly name: string;
  readonly clientOrganizationName: string;
  readonly createdAtLabel: string;
}

export function toProjectSummary(project: ProjectViewV1): ProjectSummaryVM {
  return {
    name: project.name,
    clientOrganizationName: project.clientOrganizationName,
    createdAtLabel: formatDateLabel(project.createdAt),
  };
}

export interface KnowledgePackageReadinessVM {
  readonly title: string;
  readonly statusLabel: string;
  readonly documentCount: number;
  readonly openIssueCount: number;
  readonly updatedAtLabel: string;
  readonly confirmedAtLabel: string | null;
}

export function toKnowledgePackageReadiness(
  pkg: KnowledgePackageViewV1,
): KnowledgePackageReadinessVM {
  return {
    title: pkg.title,
    statusLabel: PACKAGE_STATUS_LABELS[pkg.status],
    documentCount: pkg.documentCount,
    openIssueCount: pkg.openIssueCount,
    updatedAtLabel: formatDateLabel(pkg.updatedAt),
    confirmedAtLabel: pkg.confirmedAt !== null ? formatDateLabel(pkg.confirmedAt) : null,
  };
}

export interface KnowledgeIssueRowVM {
  readonly kindLabel: string;
  readonly severityLabel: string;
  readonly message: string;
  readonly resolved: boolean;
}

export function toKnowledgeIssueRow(issue: KnowledgeIssueViewV1): KnowledgeIssueRowVM {
  return {
    kindLabel: ISSUE_KIND_LABELS[issue.kind],
    severityLabel: ISSUE_SEVERITY_LABELS[issue.severity],
    message: issue.message,
    resolved: issue.resolved,
  };
}

export function toKnowledgeIssueRows(
  issues: readonly KnowledgeIssueViewV1[],
): readonly KnowledgeIssueRowVM[] {
  return issues.map(toKnowledgeIssueRow);
}

export interface KeywordRowVM {
  readonly keyword: string;
  readonly userQuestions: readonly string[];
  readonly priority: number;
}

export function toKeywordRow(item: KeywordQuestionViewV1): KeywordRowVM {
  return {
    keyword: item.keyword,
    userQuestions: [...item.userQuestions],
    priority: item.priority,
  };
}

export function toKeywordRows(
  items: readonly KeywordQuestionViewV1[],
): readonly KeywordRowVM[] {
  return items.map(toKeywordRow);
}

export interface DeliveryRowVM {
  readonly title: string;
  readonly statusLabel: string;
  readonly deliveredAtLabel: string;
  readonly publicationRegisteredAtLabel: string | null;
}

export function toDeliveryRow(item: ArticleDeliveryViewV1): DeliveryRowVM {
  return {
    title: item.title,
    statusLabel: DELIVERY_STATUS_LABELS[item.status],
    deliveredAtLabel: formatDateLabel(item.deliveredAt),
    publicationRegisteredAtLabel:
      item.publicationRegisteredAt !== null
        ? formatDateLabel(item.publicationRegisteredAt)
        : null,
  };
}

export function toDeliveryRows(
  items: readonly ArticleDeliveryViewV1[],
): readonly DeliveryRowVM[] {
  return items.map(toDeliveryRow);
}

export interface OpportunityRowVM {
  readonly title: string;
  readonly summary: string;
  readonly statusLabel: string;
}

export function toOpportunityRow(item: OpportunityViewV1): OpportunityRowVM {
  return {
    title: item.title,
    summary: item.summary,
    statusLabel: OPPORTUNITY_STATUS_LABELS[item.status],
  };
}

export function toOpportunityRows(
  items: readonly OpportunityViewV1[],
): readonly OpportunityRowVM[] {
  return items.map(toOpportunityRow);
}
