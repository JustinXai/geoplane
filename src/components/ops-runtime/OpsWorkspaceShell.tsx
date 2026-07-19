"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import styles from "./OpsWorkspaceShell.module.css";

const NAVIGATION = [
  ["运营总览", "/ops"], ["代理商管理", "/ops/agencies"], ["客户管理", "/ops/clients"],
  ["项目管理", "/ops/projects"], ["账号中心", "/ops/accounts"], ["关键词中心", "/ops/keywords"],
  ["AI 拓词任务", "/ops/keyword-expansion"], ["内容与审核", "/ops/content-review"],
  ["国内 AI 查询", "/ops/probes"], ["交付与报告", "/ops/delivery"],
  ["行业规则包", "/ops/rule-packs"], ["邀请与权限", "/ops/invitations"],
  ["审计中心", "/ops/audit"], ["系统健康", "/ops/system-health"],
] as const;

export function OpsWorkspaceShell({ children }: { readonly children: ReactNode }) {
  const pathname = usePathname();
  return <div className={styles.shell}>
    <aside className={styles.sidebar}>
      <div className={styles.brand}><strong>GEO 内容增长与交付系统</strong><span>平台运营工作台</span></div>
      <nav className={styles.nav} aria-label="平台运营导航">
        {NAVIGATION.map(([label, href]) => {
          const active = href === "/ops" ? pathname === href : pathname.startsWith(href);
          return <Link className={`${styles.link} ${active ? styles.active : ""}`} href={href} key={href}>{label}</Link>;
        })}
      </nav>
    </aside>
    <main className={styles.main}>
      <div className={styles.topbar}><span className={styles.context}>平台级业务与交付管理</span><span className={styles.role}>平台运营</span></div>
      <div className={styles.content}>{children}</div>
    </main>
  </div>;
}

export { styles as opsStyles };
