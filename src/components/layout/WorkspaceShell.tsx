"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import type { AccountViewV1 } from "@/runtime/api-contracts";
import { defaultApiClient } from "@/lib/api-client";

export interface WorkspaceNavItem { readonly href: string; readonly label: string; }

export function WorkspaceShell({ roleLabel, contextLabel, nav, children, notices }: { roleLabel: string; contextLabel?: string; nav: readonly WorkspaceNavItem[]; children: ReactNode; notices?: ReactNode }) {
  const pathname = usePathname();
  const [account, setAccount] = useState<AccountViewV1 | null>(null);
  useEffect(() => { void defaultApiClient.request<AccountViewV1>("/api/account").then((result) => { if (result.ok) setAccount(result.data); }); }, []);
  const context = account?.organizationName ?? contextLabel ?? "正在读取组织信息…";
  return <div className="workspace-shell"><aside className="workspace-sidebar"><div className="workspace-brand"><strong>GEO 内容增长与交付系统</strong><span>{roleLabel}</span></div><nav aria-label={`${roleLabel}导航`}><ul className="workspace-nav-list">{nav.map(item => { const active = item.href === "/app" || item.href === "/agency" ? pathname === item.href : pathname.startsWith(item.href); return <li key={item.href}><Link className="workspace-nav-link" data-active={active} href={item.href}>{item.label}</Link></li>; })}</ul></nav></aside><div><header className="workspace-topbar"><div className="workspace-context"><strong>当前组织</strong><span>{context}</span></div><div className="workspace-role">{roleLabel}</div></header>{notices}<main className="workspace-main">{children}</main></div></div>;
}
