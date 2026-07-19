import type { ReactNode } from "react";
import Link from "next/link";
import styles from "./OpsWorkspaceShell.module.css";

export function OpsPageHeader({ title, description }: { readonly title: string; readonly description: string }) {
  return <header className={styles.header}><div><p className={styles.eyebrow}>平台运营</p><h1 className={styles.title}>{title}</h1><p className={styles.description}>{description}</p></div></header>;
}

export function CapabilityGap({ detail = "当前后端尚未提供该页面所需的真实读取能力。" }: { readonly detail?: string }) {
  return <section className={styles.state} role="status"><strong>当前暂无可展示内容</strong><p><b>当前原因：</b>{detail}</p><p><b>显示条件：</b>完成对应业务资料和授权配置后，系统将显示真实数据。</p><Link className="button button-secondary" href="/ops">返回运营总览</Link></section>;
}

export function PlatformState({ kind = "empty", title, children }: { readonly kind?: "empty"|"error"|"forbidden"; readonly title: string; readonly children?: ReactNode }) {
  return <section className={`${styles.state} ${kind === "error" ? styles.error : ""} ${kind === "forbidden" ? styles.forbidden : ""}`} role={kind === "empty" ? "status" : "alert"}><strong>{title}</strong>{children}</section>;
}

export { styles as opsPageStyles };
