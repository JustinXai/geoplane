import Link from "next/link";
import { AGENCY_WORKSPACE_NAV_LINKS } from "@/lib/workspace-nav";

export { AGENCY_WORKSPACE_NAV_LINKS };

export function AgencyWorkspaceNav() {
  return (
    <nav className="cp-workspace-nav" aria-label="代理商工作台导航">
      <ul>{AGENCY_WORKSPACE_NAV_LINKS.map(({ label, href }) => <li key={href}><Link href={href}>{label}</Link></li>)}</ul>
    </nav>
  );
}
