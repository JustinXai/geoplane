import type { ReactNode } from "react";
import Link from "next/link";
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

export function Breadcrumbs({ items }: { items: readonly { label: string; href?: string }[] }) {
  return <nav className="breadcrumbs" aria-label="面包屑"><ol>{items.map((item, index) => <li key={`${item.label}-${index}`}>{item.href ? <Link href={item.href}>{item.label}</Link> : <span aria-current="page">{item.label}</span>}</li>)}</ol></nav>;
}

export function FormField({ label, required, error, help, children }: { label: string; required?: boolean; error?: string; help?: string; children: ReactNode }) {
  return <label className="form-field"><span className="form-label">{label}{required ? <b aria-hidden="true"> *</b> : null}</span>{children}{error ? <span className="field-error" role="alert">{error}</span> : help ? <span className="field-help">{help}</span> : null}</label>;
}

export function Stepper({ current, items }: { current: number; items: readonly string[] }) {
  return <ol className="stepper" aria-label="业务步骤">{items.map((item, index) => <li key={item} data-state={index < current ? "done" : index === current ? "current" : "pending"}><span>{index + 1}</span><strong>{item}</strong></li>)}</ol>;
}

export function BusinessTimeline({ items }: { items: readonly { title: string; detail?: string; time?: string }[] }) {
  return <ol className="business-timeline">{items.map((item, index) => <li key={`${item.title}-${index}`}><span className="timeline-marker" /><div><strong>{item.title}</strong>{item.detail ? <p>{item.detail}</p> : null}{item.time ? <time>{item.time}</time> : null}</div></li>)}</ol>;
}

export function DetailDrawer({ open, title, description, onClose, children }: { open: boolean; title: string; description?: string; onClose?: () => void; children: ReactNode }) {
  if (!open) return null;
  return <div className="drawer-layer"><button className="drawer-backdrop" type="button" aria-label="关闭详情" onClick={onClose} /><aside className="detail-drawer" aria-label={title}><header><div><h2>{title}</h2>{description ? <p>{description}</p> : null}</div>{onClose ? <button className="button button-secondary" type="button" onClick={onClose}>关闭</button> : null}</header><div className="drawer-content">{children}</div></aside></div>;
}

export function ConfirmDialog({ open, title, description, confirmLabel = "确认", cancelLabel = "取消", onConfirm, onCancel }: { open: boolean; title: string; description: string; confirmLabel?: string; cancelLabel?: string; onConfirm: () => void; onCancel: () => void }) {
  if (!open) return null;
  return <div className="dialog-layer" role="presentation"><div className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title"><h2 id="confirm-title">{title}</h2><p>{description}</p><div className="dialog-actions"><button type="button" className="button button-secondary" onClick={onCancel}>{cancelLabel}</button><button type="button" className="button button-primary" onClick={onConfirm}>{confirmLabel}</button></div></div></div>;
}
