/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * reconstruction_source: docs/architecture/SYSTEM_BLUEPRINT_V1.md ("agency workspace" surface),
 *   docs/architecture/MULTI_TENANT_ACCOUNT_MODEL_V1.md (AGENCY organization type, explicit
 *   client assignment rule), recovered/partial-source/00040000000C9C607C9A7F12-page.tsx
 *   (AssignmentForm, "只有有效分配中的客户可被代理商选择"),
 *   recovered/partial-source/00040000000C9C661E8C211C-page.tsx (AgencyClientCreateForm)
 * reconstruction_reason: no original file recoverable
 * original_file_unavailable: true
 *
 * Presentation-only nav for the AGENCY workspace surface (/agency/*).
 * Fixture links only, sourced from src/lib/workspace-nav.ts where they are
 * asserted to stay within /agency/* at module load - this component can
 * never render a link into /app/* or /ops/*.
 *
 * TODO(rebuild/tenancy-auth): wrap the layout that renders this nav with a
 * real AGENCY-membership + active-client-assignment check via the future
 * AuthorizationContext once it exists. This checkpoint is structure only,
 * not authorization.
 */
import Link from "next/link";
import { useParams } from "next/navigation";
import { AGENCY_WORKSPACE_NAV_LINKS } from "@/lib/workspace-nav";

export function AgencyWorkspaceNav() {
  const params = useParams();
  const agencySlug = params?.agencySlug as string | undefined;
  const projectId = params?.projectId as string | undefined;

  return (
    <nav className="cp-workspace-nav" aria-label="代理商工作台导航">
      <ul>
        {AGENCY_WORKSPACE_NAV_LINKS.map((link) => {
          let href = link.href;
          if (projectId) {
            href = href.replace("{projectId}", projectId);
          } else if (agencySlug) {
            href = href.replace("[agencySlug]", agencySlug).replace("{projectId}", "");
          }
          return (
            <li key={link.href}>
              <Link href={href}>{link.label}</Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
