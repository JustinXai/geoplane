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

export type WorkspaceSurface = "app" | "agency" | "ops";

export interface WorkspaceNavLink {
  readonly label: string;
  readonly href: string;
}

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
  { label: "总览", href: "/app" },
  { label: "知识库", href: "/app/knowledge" },
  { label: "关键词与用户问题", href: "/app/keywords" },
  { label: "内容与信源", href: "/app/content" },
  { label: "交付中心", href: "/app/delivery" },
  { label: "效果验证", href: "/app/performance" },
]);

// Checkpoint C3 update: added the six new "Agency workspace" surfaces built in
// src/app/agency/* (client projects, industry templates, batch tasks, review queue,
// delivery packages, team & permissions, white-label branding placeholder) and
// relabeled the existing "项目" placeholder link to "客户项目" to match the page it
// now points at (src/app/agency/projects/page.tsx). assertSurfaceIsolatedLinks below
// is unchanged from C1/C2 and still enforces that every href stays within /agency/*.
export const AGENCY_WORKSPACE_NAV_LINKS: readonly WorkspaceNavLink[] = assertSurfaceIsolatedLinks("agency", [
  { label: "客户", href: "/agency/clients" },
  { label: "客户分配", href: "/agency/assignments" },
  { label: "客户项目", href: "/agency/projects" },
  { label: "行业模板", href: "/agency/templates" },
  { label: "批量任务", href: "/agency/batch-tasks" },
  { label: "审核队列", href: "/agency/review-queue" },
  { label: "交付包", href: "/agency/deliveries" },
  { label: "团队与权限", href: "/agency/team" },
  { label: "品牌白标", href: "/agency/branding" },
]);

export const OPS_WORKSPACE_NAV_LINKS: readonly WorkspaceNavLink[] = assertSurfaceIsolatedLinks("ops", [
  { label: "组织", href: "/ops/organizations" },
  { label: "邀请", href: "/ops/invitations" },
  { label: "审计", href: "/ops/audit" },
]);
