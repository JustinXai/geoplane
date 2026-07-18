"use client";

/**
 * CLIENT_WORKSPACE_RUNTIME_V1 (Agent D) — the enterprise knowledge-base readiness + issues
 * screen, wired to real APIs (GET /api/knowledge/packages/[id] and .../issues).
 *
 * The package section and the quality-issues section each render all five async states via
 * the shared AsyncSection; the issues section reaches the Empty state when a package has no
 * open findings. Only human-facing readiness fields are shown — the package/issue UUIDs the
 * DTOs carry are stripped by the view-model mappers, never rendered.
 */
import Link from "next/link";
import { useAsyncData } from "../runtime/index.js";
import { AsyncSection } from "./AsyncSection.js";
import { KnowledgePackageConfirm } from "./KnowledgePackageConfirm.js";
import { loadKnowledgeIssues, loadKnowledgePackage } from "./endpoints.js";
import {
  isEmptyArray,
  toKnowledgeIssueRows,
  toKnowledgePackageReadiness,
} from "./view-models.js";

export function KnowledgePackageDetailView({ packageId }: { packageId: string }) {
  const pkg = useAsyncData(() => loadKnowledgePackage(packageId), { deps: [packageId] });
  const issues = useAsyncData(() => loadKnowledgeIssues(packageId), {
    isEmpty: isEmptyArray,
    deps: [packageId],
  });

  // A successful confirmation moves the package to CONFIRMED; refresh both the readiness header and
  // the issues list so the new status (and any resolved findings) show without a manual reload.
  function handleConfirmed() {
    pkg.reload();
    issues.reload();
  }

  return (
    <>
      <header className="cp-page-header">
        <div>
          <p className="eyebrow">
            <Link href="/app/knowledge">企业知识库</Link>
          </p>
          <AsyncSection state={pkg.state} onRetry={pkg.reload}>
            {(data) => {
              const readiness = toKnowledgePackageReadiness(data);
              return (
                <>
                  <h1>{readiness.title}</h1>
                  <span>
                    状态：{readiness.statusLabel} · 文档 {readiness.documentCount} 篇 · 待处理问题{" "}
                    {readiness.openIssueCount} 个 · 更新于 {readiness.updatedAtLabel}
                    {readiness.confirmedAtLabel !== null
                      ? ` · 确认于 ${readiness.confirmedAtLabel}`
                      : ""}
                  </span>
                  <KnowledgePackageConfirm
                    packageId={packageId}
                    status={data.status}
                    onConfirmed={handleConfirmed}
                  />
                </>
              );
            }}
          </AsyncSection>
        </div>
      </header>
      <section aria-label="质量问题">
        <h2>质量问题</h2>
        <AsyncSection
          state={issues.state}
          onRetry={issues.reload}
          empty={<p className="cp-list-row cp-list-empty">暂无待处理问题</p>}
        >
          {(rows) => (
            <ul className="cp-list">
              {toKnowledgeIssueRows(rows).map((row, index) => (
                <li className="cp-list-row" key={`${row.kindLabel}-${index}`}>
                  <span className="cp-list-title">{row.message}</span>
                  <span className="cp-list-meta">
                    类型：{row.kindLabel} · 严重度：{row.severityLabel} ·{" "}
                    {row.resolved ? "已解决" : "待处理"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </AsyncSection>
      </section>
    </>
  );
}
