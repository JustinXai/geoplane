/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * reconstruction_source: docs/architecture/SYSTEM_BLUEPRINT_V1.md ("ops console" surface),
 *   docs/architecture/MULTI_TENANT_ACCOUNT_MODEL_V1.md (PLATFORM organization type - may
 *   manage all organizations), recovered/partial-source/00040000000C9C455B787075-route.ts
 *   (requireSurfaceAuthorization("ops") + tenancyRepository.revokeInvitation),
 *   recovered/partial-source/00040000000C9C6422CCAB4F-page.tsx (tenancyRepository.listAudit,
 *   cp-table-wrap / cp-data-table convention)
 * reconstruction_reason: no original file recoverable
 * original_file_unavailable: true
 *
 * Presentation-only nav for the PLATFORM/ops workspace surface (/ops/*).
 * Fixture links only, sourced from src/lib/workspace-nav.ts where they are
 * asserted to stay within /ops/* at module load - this component can never
 * render a link into /app/* or /agency/*.
 *
 * TODO(rebuild/tenancy-auth): wrap the layout that renders this nav with a
 * real requireSurfaceAuthorization("ops")-equivalent check via the future
 * AuthorizationContext once it exists (see the recovered route.ts above for
 * the exact real, recovered shape of that pattern). This checkpoint is
 * structure only, not authorization.
 */
import Link from "next/link";
import { OPS_WORKSPACE_NAV_LINKS } from "@/lib/workspace-nav";

export function OpsWorkspaceNav() {
  return (
    <nav className="cp-workspace-nav" aria-label="平台运营导航">
      <ul>
        {OPS_WORKSPACE_NAV_LINKS.map((link) => (
          <li key={link.href}>
            <Link href={link.href}>{link.label}</Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
