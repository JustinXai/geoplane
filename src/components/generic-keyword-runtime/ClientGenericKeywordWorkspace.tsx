"use client";
import { useAsyncData } from "../runtime/index.js";
import { loadProjects } from "../client-runtime/endpoints.js";
import { GenericKeywordWorkspace } from "./GenericKeywordWorkspace.js";

export function ClientGenericKeywordWorkspace() {
  const resource = useAsyncData(loadProjects, { isEmpty: (projects) => projects.length === 0 });
  if (resource.state.status === "loading") return <section className="cp-section" role="status">正在读取项目…</section>;
  if (resource.state.status === "empty") return <section className="cp-section"><h2>暂无项目</h2><p>当前账号没有可操作项目。</p></section>;
  if (resource.state.status === "forbidden") return <section className="cp-section" role="alert"><h2>无法访问</h2><p>当前账号没有客户项目权限。</p></section>;
  if (resource.state.status === "error") return <section className="cp-section" role="alert"><h2>项目加载失败</h2><p>{resource.state.message}</p></section>;
  const project = resource.state.data[0];
  return project ? <div className="cp-stack"><section className="cp-section"><p>当前项目：{project.name}</p></section><GenericKeywordWorkspace projectId={project.id} questionsHref="/app/questions" /></div> : null;
}
