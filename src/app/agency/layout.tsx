/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * reconstruction_source: docs/architecture/SYSTEM_BLUEPRINT_V1.md ("agency workspace" surface),
 *   docs/governance/SYSTEM_INVARIANTS_V1.md (tenant isolation)
 * reconstruction_reason: no original file recoverable
 * original_file_unavailable: true
 *
 * Layout for the AGENCY workspace surface (/agency/*). Renders only the
 * agency-scoped nav (see src/components/workspace-nav/agency-workspace-nav.tsx).
 *
 * TODO(rebuild/tenancy-auth): this layout must eventually call the future
 * AuthorizationContext to verify the signed-in user is an AGENCY member
 * with an explicit, active assignment to any CLIENT organization it acts
 * on, per SYSTEM_INVARIANTS_V1 "Tenant isolation" ("no implicit or
 * wildcard access"). Currently presentation-only - no auth guard.
 */
import type { ReactNode } from "react";
import { AgencyWorkspaceNav } from "@/components/workspace-nav/agency-workspace-nav";

export default function AgencyWorkspaceLayout({ children }: { children: ReactNode }) {
  return (
    <div className="shell">
      <AgencyWorkspaceNav />
      <div className="band">{children}</div>
    </div>
  );
}
