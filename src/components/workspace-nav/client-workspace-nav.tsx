/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * reconstruction_source: docs/architecture/SYSTEM_BLUEPRINT_V1.md ("client workspace" surface),
 *   docs/architecture/MULTI_TENANT_ACCOUNT_MODEL_V1.md (CLIENT organization type),
 *   recovered/partial-source/00040000000C9C5E6C12D671-page.tsx (cp-page-header convention)
 * reconstruction_reason: no original file recoverable
 * original_file_unavailable: true
 *
 * Presentation-only nav for the CLIENT workspace surface (/app/*). Fixture
 * links only, sourced from src/lib/workspace-nav.ts where they are asserted
 * to stay within /app/* at module load - this component can never render a
 * link into /agency/* or /ops/*.
 *
 * TODO(rebuild/tenancy-auth): wrap the layout that renders this nav with a
 * real CLIENT-membership check via the future AuthorizationContext once it
 * exists. This checkpoint is structure only, not authorization.
 */
import Link from "next/link";
import { CLIENT_WORKSPACE_NAV_LINKS } from "@/lib/workspace-nav";

export function ClientWorkspaceNav() {
  return (
    <nav className="cp-workspace-nav" aria-label="客户工作台导航">
      <ul>
        {CLIENT_WORKSPACE_NAV_LINKS.map((link) => (
          <li key={link.href}>
            <Link href={link.href}>{link.label}</Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
