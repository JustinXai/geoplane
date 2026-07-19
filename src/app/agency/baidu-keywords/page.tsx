"use client";
import { AuthorizedProjectWorkspace } from "@/components/agency-runtime";
import { GenericKeywordWorkspace } from "@/components/generic-keyword-runtime";

export default function Page(){return <><header className="cp-page-header"><div><p className="eyebrow">代理商工作台</p><h1>关键词与需求数据</h1><span>按授权项目管理可选关键词资料；百度关键词是兼容来源之一。</span></div></header><AuthorizedProjectWorkspace>{project=><GenericKeywordWorkspace key={project.id} projectId={project.id} questionsHref="/agency/keyword-questions"/>}</AuthorizedProjectWorkspace></>}
