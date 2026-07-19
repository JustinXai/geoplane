/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * reconstruction_source: docs/architecture/SYSTEM_BLUEPRINT_V1.md ("client workspace" surface),
 *   docs/governance/SYSTEM_INVARIANTS_V1.md (tenant isolation)
 * reconstruction_reason: no original file recoverable
 * original_file_unavailable: true
 *
 * Layout for the CLIENT workspace surface (/app/*). Renders only the
 * client-scoped nav (see src/components/workspace-nav/client-workspace-nav.tsx).
 *
 * TODO(rebuild/tenancy-auth): this layout must eventually call the future
 * AuthorizationContext to verify the signed-in user belongs to the ACTIVE
 * CLIENT organization being viewed, per SYSTEM_INVARIANTS_V1 "Tenant
 * isolation" ("A CLIENT user belongs to at most one ACTIVE CLIENT
 * organization"). Currently presentation-only - no auth guard.
 */
import type { ReactNode } from "react";
import { WorkspaceShell } from "@/components/layout/WorkspaceShell";
import { CLIENT_WORKSPACE_NAV_LINKS } from "@/lib/workspace-nav";

export default function ClientWorkspaceLayout({ children }: { children: ReactNode }) {
  return (
    <WorkspaceShell roleLabel="客户工作台" contextLabel="当前客户组织" nav={CLIENT_WORKSPACE_NAV_LINKS}>
      {children}
    </WorkspaceShell>
  );
}
