/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * reconstruction_source: docs/architecture/SYSTEM_BLUEPRINT_V1.md ("agency workspace" surface),
 *   docs/governance/SYSTEM_INVARIANTS_V1.md (tenant isolation)
 * reconstruction_reason: no original file recoverable
 * original_file_unavailable: true
 *
 * Layout for the AGENCY workspace surface (/agency/*). Renders the agency-scoped nav
 * (see src/components/workspace-nav/agency-workspace-nav.tsx) and the shared agency shell.
 *
 * AGENCY_OPS_WORKSPACE_RUNTIME_V1 (batch 1): the shell wraps every agency page in the
 * acting-for-client store (ActingContextProvider) and mounts the persistent
 * AgencyActingBannerMount ONCE, so the "代理商代客户操作" banner is shown across ALL agency
 * pages (including client-projects and delivery packages) whenever the agency is acting for a
 * client, satisfying the frozen C3 invariant ("代理商代客户操作有醒目 Banner / 持续显示"). The
 * banner keeps no-impersonation semantics: the actor stays the agency, the client is only the
 * subject (see AgencyActingBanner / toActingBannerView).
 *
 * TODO(rebuild/tenancy-auth): this layout must eventually call the future
 * AuthorizationContext to verify the signed-in user is an AGENCY member
 * with an explicit, active assignment to any CLIENT organization it acts
 * on, per SYSTEM_INVARIANTS_V1 "Tenant isolation" ("no implicit or
 * wildcard access"). Currently presentation-only - no auth guard.
 */
import type { ReactNode } from "react";
import { ActingContextProvider, AgencyActingBannerMount, AgencyWorkspaceNav } from "@/components/agency-runtime";

export default function AgencyWorkspaceLayout({ children }: { children: ReactNode }) {
  return (
    <div className="shell">
      <AgencyWorkspaceNav />
      <ActingContextProvider>
        <div className="band">
          <AgencyActingBannerMount />
          {children}
        </div>
      </ActingContextProvider>
    </div>
  );
}
