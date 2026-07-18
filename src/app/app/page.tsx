"use client";

/**
 * CLIENT_WORKSPACE_RUNTIME_V1 (Agent D) — client workspace 总览 (dashboard), wired to real
 * APIs (replaces the C2 fixtures). Loads the signed-in account (GET /api/account) and the
 * caller's project list (GET /api/projects), lets the user pick the current project (first
 * by default) and shows that project's overview. Both data sections render all five async
 * states via the shared AsyncSection. Only human-facing fields are shown — the account /
 * project UUIDs are stripped by the view-model mappers.
 */
import { useState } from "react";
import Link from "next/link";
import { useAsyncData } from "../../components/runtime/index.js";
import { AsyncSection } from "../../components/client-runtime/AsyncSection.js";
import { loadAccount, loadProjects } from "../../components/client-runtime/endpoints.js";
import {
  isEmptyArray,
  selectActiveProject,
  toAccountSummary,
  toProjectOptions,
  toProjectSummary,
} from "../../components/client-runtime/view-models.js";

export default function ClientWorkspaceHomePage() {
  const account = useAsyncData(loadAccount);
  const projects = useAsyncData(loadProjects, { isEmpty: isEmptyArray });
  const [activeIndex, setActiveIndex] = useState(0);

  return (
    <>
      <header className="cp-page-header">
        <div>
          <AsyncSection state={account.state} onRetry={account.reload}>
            {(data) => {
              const summary = toAccountSummary(data);
              return (
                <>
                  <p className="eyebrow">
                    {summary.surfaceLabel} · {summary.organizationName}
                  </p>
                  <h1>总览</h1>
                  <span>
                    {summary.greetingName} · {summary.roleLabel} · {summary.organizationTypeLabel}
                  </span>
                </>
              );
            }}
          </AsyncSection>
        </div>
      </header>

      <section aria-label="当前项目概况">
        <AsyncSection
          state={projects.state}
          onRetry={projects.reload}
          empty={<p className="cp-list-row cp-list-empty">暂无项目 - 项目就绪后将在此显示。</p>}
        >
          {(list) => {
            const active = selectActiveProject(list, activeIndex);
            const options = toProjectOptions(list);
            if (active === null) {
              return <p className="cp-list-row cp-list-empty">暂无项目。</p>;
            }
            const summary = toProjectSummary(active);
            return (
              <>
                {options.length > 1 ? (
                  <label className="cp-field">
                    当前项目：
                    <select
                      value={activeIndex < options.length ? activeIndex : 0}
                      onChange={(event) => setActiveIndex(Number(event.target.value))}
                    >
                      {options.map((option) => (
                        <option key={option.index} value={option.index}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <div className="cp-card-grid">
                  <div className="cp-card">
                    <p className="cp-card-value">{summary.name}</p>
                    <p className="cp-card-label">项目</p>
                  </div>
                  <div className="cp-card">
                    <p className="cp-card-value">{summary.clientOrganizationName}</p>
                    <p className="cp-card-label">所属企业</p>
                  </div>
                  <div className="cp-card">
                    <p className="cp-card-value">{summary.createdAtLabel}</p>
                    <p className="cp-card-label">创建于</p>
                  </div>
                </div>
              </>
            );
          }}
        </AsyncSection>
      </section>

      <section aria-label="快捷入口">
        <ul>
          <li>
            <Link href="/app/knowledge">进入知识库</Link>
          </li>
          <li>
            <Link href="/app/keywords">进入关键词与用户问题</Link>
          </li>
          <li>
            <Link href="/app/content">进入内容与信源</Link>
          </li>
          <li>
            <Link href="/app/delivery">进入交付中心</Link>
          </li>
          <li>
            <Link href="/app/performance">进入效果验证</Link>
          </li>
        </ul>
      </section>
    </>
  );
}
