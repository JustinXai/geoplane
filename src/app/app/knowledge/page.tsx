/**
 * CLIENT_WORKSPACE_RUNTIME_V1 (Agent K) — 企业知识库 index, now wired to real APIs.
 *
 * Flow: load active project -> list its knowledge packages -> show list or empty state.
 * Empty state shows a "创建知识包" primary action that opens an inline title form.
 * Each package row links to the detail page (/app/knowledge/[packageId]) where the user
 * confirms readiness and uploads files.
 *
 * Permission model (SYSTEM_INVARIANTS_V1): the session cookie only carries the user id;
 * the client organization is re-derived server-side. A client can only see/create packages
 * under their own organization's projects; an agency/platform user sees their authorized
 * clients' packages.
 */
"use client";

import { useState } from "react";
import Link from "next/link";
import { useAsyncData } from "../../../components/runtime/index.js";
import { AsyncSection } from "../../../components/client-runtime/AsyncSection.js";
import {
  createKnowledgePackage,
  loadKnowledgePackages,
  loadProjects,
} from "../../../components/client-runtime/endpoints.js";
import { useWriteAction, WriteActionFeedback } from "../../../components/client-runtime/WriteAction.js";
import { isEmptyArray, PACKAGE_STATUS_LABELS, formatDateLabel } from "../../../components/client-runtime/view-models.js";
import type { ProjectViewV1 } from "../../../runtime/api-contracts/index.js";
import { safeBusinessDisplayName } from "../../../runtime/ui-adapters/formatters.js";

function selectActiveProject(projects: readonly ProjectViewV1[]): ProjectViewV1 | null {
  return projects.length > 0 ? (projects[0] ?? null) : null;
}

function PackageList({ projectId }: { readonly projectId: string }) {
  const packages = useAsyncData(
    () => loadKnowledgePackages(projectId),
    { isEmpty: isEmptyArray, deps: [projectId] },
  );

  return (
    <AsyncSection
      state={packages.state}
      onRetry={packages.reload}
      empty={
        <div className="cp-empty-state">
          <strong>尚无知识包</strong>
          <p>当前项目下还没有企业知识包。创建一个知识包来管理您的企业介绍、产品服务、案例等资料。</p>
          <p className="cp-list-meta">知识包就绪后，可以基于企业资料生成用户问题和内容方向。</p>
        </div>
      }
    >
      {(rows) => (
        <ul className="cp-list">
          {rows.map((pkg) => (
            <li key={pkg.id} className="cp-list-row">
              <span className="cp-list-title">
                <Link href={`/app/knowledge/${pkg.id}`}>
                  {safeBusinessDisplayName(pkg.title, "知识包")}
                </Link>
              </span>
              <span className="cp-list-meta">
                状态：{PACKAGE_STATUS_LABELS[pkg.status]}
                {" · "}
                文档 {pkg.documentCount} 篇
                {" · "}
                待处理问题 {pkg.openIssueCount} 个
                {" · "}
                更新于 {formatDateLabel(pkg.updatedAt)}
                {pkg.confirmedAt !== null
                  ? ` · 确认于 ${formatDateLabel(pkg.confirmedAt)}`
                  : ""}
              </span>
              <div className="cp-actions">
                <Link className="cp-button" href={`/app/knowledge/${pkg.id}`}>
                  查看详情
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </AsyncSection>
  );
}

function CreatePackageForm({
  projectId,
  onCreated,
}: {
  readonly projectId: string;
  readonly onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const action = useWriteAction(
    () => createKnowledgePackage(projectId, title.trim()),
    onCreated,
  );

  if (action.state.status === "success") {
    return (
      <p className="cp-placeholder-note" role="status" aria-live="polite">
        知识包已创建。正在刷新列表…
      </p>
    );
  }

  return (
    <div className="cp-form-section" role="group" aria-label="创建知识包">
      <label htmlFor="package-title" className="cp-form-label">
        知识包名称
      </label>
      <input
        id="package-title"
        type="text"
        className="cp-input"
        placeholder="例如：企业介绍、产品服务、常见问题"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        disabled={action.state.status === "submitting"}
        onKeyDown={(e) => {
          if (e.key === "Enter" && title.trim() !== "") {
            action.submit();
          }
        }}
      />
      <div className="cp-actions">
        <button
          type="button"
          className="cp-button cp-button-primary"
          disabled={title.trim() === "" || action.state.status === "submitting"}
          onClick={() => action.submit()}
        >
          创建知识包
        </button>
        <button
          type="button"
          className="cp-button"
          onClick={() => setTitle("")}
        >
          取消
        </button>
      </div>
      <WriteActionFeedback state={action.state} successLabel="知识包已创建。" />
    </div>
  );
}

export default function KnowledgeBasePage() {
  const projects = useAsyncData(loadProjects, { isEmpty: (v) => v.length === 0 });
  const [showCreateForm, setShowCreateForm] = useState(false);

  return (
    <>
      <header className="cp-page-header">
        <div>
          <p className="eyebrow">客户工作台</p>
          <h1>企业知识库</h1>
          <span>管理企业介绍、产品服务、案例等资料。知识包就绪后可以生成用户问题和内容方向。</span>
        </div>
      </header>

      <AsyncSection
        state={projects.state}
        onRetry={projects.reload}
        empty={
          <div className="cp-empty-state">
            <strong>当前账号暂无可访问项目</strong>
            <p>当企业尚未分配项目，或项目授权已结束时会显示此状态。请联系负责该客户的代理商或平台运营人员完成分配。</p>
          </div>
        }
      >
        {(projectList) => {
          const project = selectActiveProject(projectList);
          if (!project) return null;

          return (
            <>
              <section className="cp-section">
                <div className="cp-actions">
                  <div>
                    <h2>{safeBusinessDisplayName(project.name, "项目")}</h2>
                    <p className="cp-list-meta">
                      {safeBusinessDisplayName(project.clientOrganizationName)} · 知识包列表
                    </p>
                  </div>
                  {!showCreateForm && (
                    <button
                      type="button"
                      className="cp-button cp-button-primary"
                      onClick={() => setShowCreateForm(true)}
                    >
                      创建知识包
                    </button>
                  )}
                </div>
              </section>

              {showCreateForm && (
                <CreatePackageForm
                  projectId={project.id}
                  onCreated={() => {
                    setShowCreateForm(false);
                  }}
                />
              )}

              <section aria-label="知识包列表">
                <PackageList projectId={project.id} />
              </section>

              <section className="cp-section" aria-label="知识包说明">
                <h2>关于知识包</h2>
                <div className="cp-stack">
                  <p>知识包是管理企业资料的容器。每个知识包可以包含多份文档（企业介绍、产品服务、案例、常见问题等）。</p>
                  <p>上传企业资料后，系统会自动检查资料完整性并标注待处理问题。确认资料就绪后，可以基于企业知识生成用户问题和内容方向。</p>
                  <p className="cp-list-meta">
                    知识包状态：草稿 {"->"} 审核中 {"->"} 已确认（资料就绪，可生成内容）
                  </p>
                </div>
              </section>
            </>
          );
        }}
      </AsyncSection>
    </>
  );
}
