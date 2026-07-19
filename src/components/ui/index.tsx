import type { ReactNode } from "react";
import { statusText } from "@/lib/i18n/zh-CN";

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: ReactNode }) {
  return <header className="page-header"><div>{eyebrow ? <p className="page-eyebrow">{eyebrow}</p> : null}<h1 className="page-title">{title}</h1>{description ? <span className="page-description">{description}</span> : null}</div>{actions}</header>;
}

export function MetricCard({ label, value, help }: { label: string; value: ReactNode; help?: string }) {
  return <article className="metric-card"><div className="metric-label">{label}</div><div className="metric-value">{value}</div>{help ? <div className="metric-help">{help}</div> : null}</article>;
}

export function SectionCard({ title, description, actions, children }: { title: string; description?: string; actions?: ReactNode; children: ReactNode }) {
  return <section className="section-card"><div className="section-heading"><div><h2>{title}</h2>{description ? <p>{description}</p> : null}</div>{actions}</div>{children}</section>;
}

function tone(status: string): "success" | "warning" | "danger" | "info" | "neutral" {
  if (["ACTIVE","APPROVED","CONFIRMED","READY","DELIVERED","COMPLETED","AUTHORIZED"].includes(status)) return "success";
  if (["FAILED","REJECTED","BLOCKED","REVOKED","EXPIRED"].includes(status)) return "danger";
  if (["PENDING","NEEDS_HUMAN_REVIEW","WAITING_CLIENT","IN_PROGRESS","UNVERIFIED"].includes(status)) return "warning";
  return "neutral";
}

export function StatusTag({ status, label }: { status: string; label?: string }) {
  return <span className="status-tag" data-tone={tone(status)}><span className="status-dot" />{label ?? statusText(status)}</span>;
}

export function StatePanel({ title, description, tone = "empty", children }: { title: string; description: string; tone?: "empty" | "error" | "forbidden" | "loading" | "success"; children?: ReactNode }) {
  return <section className="state-panel" data-state={tone}><div>{tone === "loading" ? <div className="skeleton" style={{ width: 180, margin: "0 auto 14px" }} /> : null}<h2>{title}</h2><p>{description}</p>{children ? <div style={{ marginTop: 14 }}>{children}</div> : null}</div></section>;
}

export function ProgressBar({ value, label }: { value: number; label: string }) {
  const safe = Math.max(0, Math.min(100, value));
  return <div aria-label={label}><div className="progress"><span style={{ width: `${safe}%` }} /></div><span className="field-help">{label}：{safe}%</span></div>;
}

export function FeedbackMessage({ tone, title, description }: { tone: "success" | "error" | "info"; title: string; description?: string }) {
  return <div className="feedback-message" data-tone={tone} role={tone === "error" ? "alert" : "status"}><strong>{title}</strong>{description ? <span>{description}</span> : null}</div>;
}
