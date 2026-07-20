"use client";

/**
 * CLIENT_WORKSPACE_RUNTIME_V1 — 简报列表 (Brief List) page.
 *
 * Loads ArticleBriefs for the active project and shows each brief with its latest draft status.
 * No new pages or animations — operational additions to the existing dashboard flow.
 *
 * Flow: Brief -> 创建 Draft -> Draft 详情 -> 运行轻门禁 -> 查看修复结果 -> 提交人工审核 -> 审批或退回 -> 创建交付包 -> 登记人工交付 -> 查看交付结果
 */
import Link from "next/link";
import { useAsyncData } from "@/components/runtime";
import { AsyncSection } from "@/components/client-runtime/AsyncSection.js";
import { loadActiveProjectBriefs } from "@/components/client-runtime/endpoints.js";
import { isEmptyArray, formatDateLabel } from "@/components/client-runtime/view-models.js";

const RISK_LABELS: Record<string, string> = {
  STANDARD: "标准",
  ESCALATED_FOR_HUMAN_REVIEW: "需人工审核",
};

const DRAFT_STATUS_LABELS: Record<string, string> = {
  DRAFT: "草稿",
  SEALED: "已封存",
};

function toBriefStatusLabel(
  latestDraftId: string | null,
  hasGateResults: boolean,
  hasApproval: boolean,
): string {
  if (hasApproval) return "已批准";
  if (hasGateResults) return "门禁已运行";
  if (latestDraftId) return "待运行门禁";
  return "待生成草稿";
}

export default function BriefListPage() {
  const { state, reload } = useAsyncData(loadActiveProjectBriefs, { isEmpty: isEmptyArray });

  return (
    <>
      <header className="cp-page-header">
        <div>
          <p className="eyebrow">客户工作台</p>
          <h1>简报</h1>
          <span>简报及其最新草稿状态一览。</span>
        </div>
      </header>

      <AsyncSection
        state={state}
        onRetry={reload}
        empty={<p className="cp-list-row cp-list-empty">暂无简报。</p>}
      >
        {(items) => (
          <ul className="cp-list">
            {items.map((item) => (
              <li className="cp-list-row" key={item.briefId}>
                <span className="cp-list-title">{item.workingTitle}</span>
                <span className="cp-list-meta">
                  风险等级：{RISK_LABELS[item.riskLevel] ?? item.riskLevel}
                  {item.latestDraftId ? (
                    <>
                      {" · "}草稿版本 v{String(item.latestDraftVersion ?? "?")}
                      {" · "}{DRAFT_STATUS_LABELS[item.latestDraftStatus ?? ""] ?? item.latestDraftStatus ?? "未知"}
                    </>
                  ) : null}
                </span>
                <span className="cp-list-summary">
                  状态：{toBriefStatusLabel(item.latestDraftId, item.hasGateResults, item.hasApproval)}
                  {" · "}创建于 {formatDateLabel(item.createdAt)}
                  {item.outline.length > 0 ? ` · ${item.outline.length} 个章节` : ""}
                </span>
                {item.latestDraftId ? (
                  <Link
                    href={`/app/drafts/${item.latestDraftId}`}
                    className="cp-button"
                  >
                    查看草稿
                  </Link>
                ) : (
                  <span className="cp-placeholder-note">暂无草稿</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </AsyncSection>
    </>
  );
}
