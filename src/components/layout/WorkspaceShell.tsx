import Link from "next/link";
import type { ReactNode } from "react";

export interface WorkspaceNavItem { readonly href: string; readonly label: string; }

export function WorkspaceShell({ roleLabel, contextLabel, nav, children, notices }: { roleLabel: string; contextLabel: string; nav: readonly WorkspaceNavItem[]; children: ReactNode; notices?: ReactNode }) {
  return <div className="workspace-shell"><aside className="workspace-sidebar"><div className="workspace-brand"><strong>GEO 内容增长与交付系统</strong><span>{roleLabel}</span></div><nav aria-label={`${roleLabel}导航`}><ul className="workspace-nav-list">{nav.map(item => <li key={item.href}><Link className="workspace-nav-link" href={item.href}>{item.label}</Link></li>)}</ul></nav></aside><div><header className="workspace-topbar"><div className="workspace-context"><strong>当前工作范围</strong><span>{contextLabel}</span></div><div className="workspace-role">{roleLabel}</div></header>{notices}<main className="workspace-main">{children}</main></div></div>;
}
