"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import type { AccountViewV1 } from "../../runtime/api-contracts/index.js";
import { defaultApiClient } from "../../lib/api-client/index.js";
import { safeBusinessDisplayName } from "../../runtime/ui-adapters/formatters.js";

export interface WorkspaceNavItem { readonly href: string; readonly label: string; readonly group?: string; }

export function isLocalSafetyIndicatorEnabled(value = process.env.NEXT_PUBLIC_GEO_LOCAL_SAFE_RUNTIME): boolean {
  return value?.trim().toUpperCase() === "TRUE";
}

export function WorkspaceShell({ roleLabel, contextLabel, nav, children, notices }: { roleLabel: string; contextLabel?: string; nav: readonly WorkspaceNavItem[]; children: ReactNode; notices?: ReactNode }) {
  const pathname = usePathname();
  const [account, setAccount] = useState<AccountViewV1 | null>(null);
  useEffect(() => { void defaultApiClient.request<AccountViewV1>("/api/account").then((result) => { if (result.ok) setAccount(result.data); }); }, []);
  const rawContext = account?.organizationName ?? contextLabel;
  const context = rawContext ? safeBusinessDisplayName(rawContext) : "正在读取组织信息…";
  const showLocalSafetyIndicator = isLocalSafetyIndicatorEnabled();
  return <div className="workspace-shell"><aside className="workspace-sidebar"><div className="workspace-brand"><span className="workspace-brand-mark">GEO</span><div><strong>国内 GEO 运营与交付系统</strong><span>{roleLabel}</span></div></div><nav aria-label={`${roleLabel}导航`}><ul className="workspace-nav-list">{nav.map((item, index) => { const active = item.href === "/app" || item.href === "/agency" || item.href === "/ops" ? pathname === item.href : pathname.startsWith(item.href); const showGroup = Boolean(item.group && item.group !== nav[index - 1]?.group); return <li key={item.href}>{showGroup ? <span className="workspace-nav-group">{item.group}</span> : null}<Link aria-current={active ? "page" : undefined} className="workspace-nav-link" data-active={active} href={item.href}>{item.label}</Link></li>; })}</ul></nav>{showLocalSafetyIndicator ? <div className="workspace-sidebar-foot">本地安全运行</div> : null}</aside><div className="workspace-stage"><header className="workspace-topbar"><div className="workspace-context"><span className="workspace-context-label">当前组织</span><strong>{context}</strong></div><div className="workspace-role">{roleLabel}</div></header>{notices}<main className="workspace-main">{children}</main></div></div>;
}
