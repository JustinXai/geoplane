"use client";

import { AuthorizedProjectWorkspace } from "@/components/agency-runtime";
import { KeywordExpansionWorkspace } from "@/components/account-keyword-runtime";
export default function Page(){return <><header className="cp-page-header"><div><p className="eyebrow">代理商工作台</p><h1>扩展词与问题整理</h1><span>使用确定性离线组合生成预览，所有结果必须逐条人工确认。</span></div></header><AuthorizedProjectWorkspace>{project=><section className="cp-section"><h2>{project.name} · 扩展词与问题</h2><KeywordExpansionWorkspace projectId={project.id}/></section>}</AuthorizedProjectWorkspace></>}
