/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * reconstruction_source: docs/governance/SYSTEM_INVARIANTS_V1.md ("Tenant isolation" section),
 *   docs/architecture/MULTI_TENANT_ACCOUNT_MODEL_V1.md (PLATFORM/AGENCY/CLIENT organization
 *   types), docs/architecture/SYSTEM_BLUEPRINT_V1.md ("Workspace surfaces: client workspace,
 *   agency workspace, ops console" + evidence note citing the recovered
 *   redirect("/app/projects/example-enterprise/knowledge") path), recovered/partial-source
 *   page.tsx files (cp-page-header convention, Chinese UI copy, "只有有效分配中的客户可被
 *   代理商选择" assignment-scoping language)
 * reconstruction_reason: no original file recoverable (see docs/rebuild/RECOVERY_GAP_ANALYSIS.md,
 *   P0 "source root layout" gap and P1 tenancy/auth partial-recovery notes)
 * original_file_unavailable: true
 *
 * Fixture nav data + a structural (presentation-layer only) tenant-isolation
 * guard for the three workspace surfaces. This is checkpoint C1 "shell"
 * scope: it proves a surface's nav can never *literally contain* a link
 * into another surface. It is NOT real authorization - it does not check
 * who the signed-in user is or what organization/role they hold.
 *
 * TODO(rebuild/tenancy-auth): once the future AuthorizationContext exists,
 * every workspace layout that renders one of these navs must also perform
 * a real, request-time membership/role check (see recovered/partial-source
 * 00040000000C9C455B787075-route.ts for the shape of the existing
 * requireSurfaceAuthorization("ops") pattern this should mirror for "app"
 * and "agency"). Structural link isolation here is a defense-in-depth net,
 * not a substitute for that.
 */

import { DOMESTIC_DETECTION_ENABLED, PUBLICATION_EXECUTOR_ENABLED } from './feature-flags';

export type WorkspaceSurface = "app" | "agency" | "ops";

export interface WorkspaceNavLink {
  readonly label: string;
  readonly href: string;
  readonly group?: string;
}

const DETECTION_PROTOTYPE_ENABLED =
  process.env.NEXT_PUBLIC_INDEPENDENT_DETECTION_PROTOTYPE_ENABLED?.trim().toUpperCase() === "TRUE";

const SURFACE_PATH_PREFIX: Record<WorkspaceSurface, string> = {
  app: "/app",
  agency: "/agency",
  ops: "/ops",
};

export function isLinkWithinSurface(surface: WorkspaceSurface, href: string): boolean {
  const prefix = SURFACE_PATH_PREFIX[surface];
  return href === prefix || href.startsWith(`${prefix}/`);
}

/**
 * Throws at module-init time (i.e. as soon as a nav module is imported) if
 * a fixture link crosses into another surface. Returns the same array so it
 * can be assigned directly to an exported constant.
 */
export function assertSurfaceIsolatedLinks(
  surface: WorkspaceSurface,
  links: readonly WorkspaceNavLink[],
): readonly WorkspaceNavLink[] {
  for (const link of links) {
    if (!isLinkWithinSurface(surface, link.href)) {
      throw new Error(
        `Tenant isolation violation: "${surface}" workspace nav must not link to "${link.href}" ` +
          `(see docs/governance/SYSTEM_INVARIANTS_V1.md, "Tenant isolation")`,
      );
    }
  }
  return links;
}

// Fixture-only placeholder data. No real customer data, no database.

// Checkpoint C2 update: the C1 placeholder hrefs (/app/projects, /app/deliverables)
// pointed at surfaces that did not exist yet. This now links to the six real client
// workspace surfaces built in checkpoint C2 (src/app/app/*, see
// docs/architecture/SYSTEM_BLUEPRINT_V1.md business core items 1-4 + post-delivery
// performance validation). Still fixture-only data - assertSurfaceIsolatedLinks below
// is unchanged from C1 and still enforces that every href stays within /app/*.
export const CLIENT_WORKSPACE_NAV_LINKS: readonly WorkspaceNavLink[] = assertSurfaceIsolatedLinks("app", [
  { group: "工作概览", label: "项目总览", href: "/app" },
  { group: "企业基础", label: "企业资料", href: "/app/enterprise" },
  { group: "企业基础", label: "企业知识库", href: "/app/knowledge" },
  { group: "企业基础", label: "账号授权", href: "/app/accounts" },
  { group: "内容生产", label: "关键词与需求数据", href: "/app/keywords" },
  { group: "内容生产", label: "用户问题", href: "/app/questions" },
  { group: "内容生产", label: "内容与交付", href: "/app/content" },
  { group: "内容生产", label: "内容审核", href: "/app/content-review" },
  ...(DETECTION_PROTOTYPE_ENABLED ? [{ group: "外部集成实验", label: "独立检测原型", href: "/app/ai-results" }] : []),
  { group: "交付与报告", label: "内容草稿", href: "/app/delivery" },
  { group: "交付与报告", label: "客户报告", href: "/app/delivery" },
]);

// Checkpoint C3 update: added the six new "Agency workspace" surfaces built in
// src/app/agency/* (client projects, industry templates, batch tasks, review queue,
// delivery packages, team & permissions, white-label branding placeholder) and
// relabeled the existing "项目" placeholder link to "客户项目" to match the page it
// now points at (src/app/agency/projects/page.tsx). assertSurfaceIsolatedLinks below
// is unchanged from C1/C2 and still enforces that every href stays within /agency/*.
export const AGENCY_WORKSPACE_NAV_LINKS: readonly WorkspaceNavLink[] = assertSurfaceIsolatedLinks("agency", [
  { group: "工作概览", label: "代理商总览", href: "/agency" },
  { group: "客户管理", label: "授权客户", href: "/agency/clients" },
  { group: "客户管理", label: "客户项目", href: "/agency/projects" },
  { group: "客户管理", label: "待办中心", href: "/agency/todos" },
  { group: "生产协作", label: "账号中心", href: "/agency/accounts" },
  { group: "生产协作", label: "企业知识库", href: "/agency/knowledge" },
  { group: "生产协作", label: "关键词与需求数据", href: "/agency/baidu-keywords" },
  { group: "生产协作", label: "智能拓词", href: "/agency/ai-expansion" },
  { group: "生产协作", label: "用户问题", href: "/agency/keyword-questions" },
  { group: "生产协作", label: "内容生产", href: "/agency/content" },
  { group: "生产协作", label: "内容审核", href: "/agency/review-queue" },
  ...(DOMESTIC_DETECTION_ENABLED ? [{ group: "国内 AI", label: "国内 AI 探测", href: "/agency/projects/{projectId}/detection" }] : []),
  ...(PUBLICATION_EXECUTOR_ENABLED ? [{ group: "国内 AI", label: "草稿同步", href: "/agency/projects/{projectId}/publication" }] : []),
  ...(DETECTION_PROTOTYPE_ENABLED ? [{ group: "外部集成实验", label: "独立检测原型", href: "/agency/manual-probe" }] : []),
  { group: "交付与报告", label: "交付管理", href: "/agency/deliveries" },
  { group: "交付与报告", label: "客户报告", href: "/agency/reports" },
  { group: "组织设置", label: "团队与权限", href: "/agency/team" },
]);

// Checkpoint C4 update: added the eight new "Platform/Ops workspace" surfaces built in
// src/app/ops/* (platform-wide client assignments, execution records, Evidence audit,
// platform-wide review queue, models & usage, rule packs, publisher connectors, system
// health) and relabeled the existing "审计" placeholder link to "账户审计" to match the
// page it points at (src/app/ops/audit/page.tsx, which closely follows the recovered
// evidence pattern in recovered/partial-source/00040000000C9C6422CCAB4F-page.tsx).
// assertSurfaceIsolatedLinks below is unchanged from C1/C2/C3 and still enforces that
// every href stays within /ops/*.
export const OPS_WORKSPACE_NAV_LINKS: readonly WorkspaceNavLink[] = assertSurfaceIsolatedLinks("ops", [
  { group: "工作概览", label: "运营总览", href: "/ops" },
  { group: "组织与客户", label: "组织管理", href: "/ops/organizations" },
  { group: "组织与客户", label: "代理商管理", href: "/ops/agencies" },
  { group: "组织与客户", label: "客户管理", href: "/ops/clients" },
  { group: "组织与客户", label: "项目管理", href: "/ops/projects" },
  { group: "组织与客户", label: "客户分配", href: "/ops/client-assignments" },
  { group: "业务运营", label: "账号中心", href: "/ops/accounts" },
  { group: "业务运营", label: "关键词与需求数据", href: "/ops/keywords" },
  { group: "业务运营", label: "智能拓词", href: "/ops/keyword-expansion" },
  { group: "业务运营", label: "内容审核", href: "/ops/content-review" },
  ...(DETECTION_PROTOTYPE_ENABLED ? [{ group: "外部集成实验", label: "独立检测原型", href: "/ops/probes" }] : []),
  { group: "交付与报告", label: "交付与报告", href: "/ops/delivery" },
  { group: "平台治理", label: "邀请与权限", href: "/ops/invitations" },
  { group: "平台治理", label: "审计中心", href: "/ops/audit" },
  { group: "平台治理", label: "系统健康", href: "/ops/system-health" },
]);
