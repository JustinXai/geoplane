import type { ReactNode } from "react";
import { WorkspaceShell } from "@/components/layout/WorkspaceShell";
import { OPS_WORKSPACE_NAV_LINKS } from "@/lib/workspace-nav";

export default function OpsWorkspaceLayout({ children }: { children: ReactNode }) {
  return <WorkspaceShell roleLabel="平台运营工作台" contextLabel="平台级业务与交付管理" nav={OPS_WORKSPACE_NAV_LINKS}>{children}</WorkspaceShell>;
}
