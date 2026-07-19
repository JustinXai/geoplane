import type { ReactNode } from "react";
import { OpsWorkspaceShell } from "@/components/ops-runtime";

export default function OpsWorkspaceLayout({ children }: { children: ReactNode }) {
  return <OpsWorkspaceShell>{children}</OpsWorkspaceShell>;
}
