/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * reconstruction_source: docs/architecture/SYSTEM_BLUEPRINT_V1.md ("ops console" surface),
 *   docs/governance/SYSTEM_INVARIANTS_V1.md (tenant isolation),
 *   recovered/partial-source/00040000000C9C455B787075-route.ts (requireSurfaceAuthorization("ops"))
 * reconstruction_reason: no original file recoverable
 * original_file_unavailable: true
 *
 * Layout for the PLATFORM/ops workspace surface (/ops/*). Renders only the
 * ops-scoped nav (see src/components/workspace-nav/ops-workspace-nav.tsx).
 *
 * TODO(rebuild/tenancy-auth): this layout must eventually call the future
 * AuthorizationContext's requireSurfaceAuthorization("ops")-equivalent
 * (real, recovered shape in the route.ts cited above) to verify the
 * signed-in user is a PLATFORM member before rendering. Currently
 * presentation-only - no auth guard.
 */
import type { ReactNode } from "react";
import { OpsWorkspaceNav } from "@/components/workspace-nav/ops-workspace-nav";

export default function OpsWorkspaceLayout({ children }: { children: ReactNode }) {
  return (
    <div className="shell">
      <OpsWorkspaceNav />
      <div className="band">{children}</div>
    </div>
  );
}
