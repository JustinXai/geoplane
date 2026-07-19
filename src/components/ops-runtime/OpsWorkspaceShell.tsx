import type { ReactNode } from "react";
import { WorkspaceShell } from "../layout/WorkspaceShell.js";
import { OPS_WORKSPACE_NAV_LINKS } from "../../lib/workspace-nav.js";
import styles from "./OpsWorkspaceShell.module.css";

export function OpsWorkspaceShell({ children }: { readonly children: ReactNode }) {
  return <WorkspaceShell roleLabel="平台运营工作台" contextLabel="平台级业务与交付管理" nav={OPS_WORKSPACE_NAV_LINKS}>{children}</WorkspaceShell>;
}

export { styles as opsStyles };
