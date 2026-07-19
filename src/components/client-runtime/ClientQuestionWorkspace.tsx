"use client";

import Link from "next/link";
import { KeywordExpansionHistory } from "../account-keyword-runtime/index.js";
import { useAsyncData } from "../runtime/index.js";
import { ok, type Result } from "../../lib/api-client/http.js";
import type { KeywordQuestionViewV1, ProjectViewV1 } from "../../runtime/api-contracts/index.js";
import { AsyncSection } from "./AsyncSection.js";
import { loadKeywordQuestions, loadProjects } from "./endpoints.js";
import { selectActiveProject } from "./view-models.js";
import { KnowledgeFirstQuestionWorkspace } from "./KnowledgeFirstQuestionWorkspace.js";

interface QuestionWorkspaceData {
  readonly project: ProjectViewV1;
  readonly confirmedMappings: readonly KeywordQuestionViewV1[];
}

async function loadQuestionWorkspace(): Promise<Result<QuestionWorkspaceData | null>> {
  const projects = await loadProjects();
  if (!projects.ok) return projects;
  const project = selectActiveProject(projects.data);
  if (!project) return ok(null);
  const mappings = await loadKeywordQuestions(project.id);
  if (!mappings.ok) return mappings;
  return ok({ project, confirmedMappings: mappings.data });
}

export function ClientQuestionWorkspace() {
  const resource = useAsyncData(loadQuestionWorkspace, { isEmpty: (value) => value === null });
  return <AsyncSection state={resource.state} onRetry={resource.reload} empty={<p className="cp-list-row cp-list-empty">暂无可访问项目。</p>}>
    {(data) => data === null ? null : <div className="cp-stack">
      <KnowledgeFirstQuestionWorkspace projectId={data.project.id} onConfirmed={resource.reload} />
      <section className="cp-card">
        <div className="cp-actions"><div><h2>待确认的用户问题</h2><p>当前项目：{data.project.name}</p></div><Link className="cp-button" href="/app/keywords">录入扩展词与问题</Link></div>
        <KeywordExpansionHistory projectId={data.project.id} questionsOnly />
      </section>
      <section className="cp-card"><h2>已建立的关键词与问题关系</h2>
        {data.confirmedMappings.length === 0 ? <p className="cp-list-row cp-list-empty">暂无已建立的关系。确认扩展结果不会伪造百度需求数据；后续业务关系仍按现有项目流程建立。</p> : <ul className="cp-list">{data.confirmedMappings.map((row) => <li className="cp-list-row" key={row.keyword}><span className="cp-list-title">{row.keyword}</span><span className="cp-list-meta">优先级 {row.priority}</span><span className="cp-list-summary">{row.userQuestions.join(" · ")}</span></li>)}</ul>}
      </section>
    </div>}
  </AsyncSection>;
}
