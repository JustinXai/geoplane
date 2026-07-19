"use client";

import { AuthorizedProjectWorkspace } from "@/components/agency-runtime";
import { KeywordExpansionPanel } from "@/components/account-keyword-runtime";
export default function Page(){return <><header className="cp-page-header"><div><p className="eyebrow">代理商工作台</p><h1>AI 拓词</h1><span>使用确定性离线组合生成预览，所有结果必须人工确认。</span></div></header><AuthorizedProjectWorkspace>{project=><section className="cp-section"><h2>{project.name} · 离线拓词</h2><KeywordExpansionPanel projectId={project.id}/></section>}</AuthorizedProjectWorkspace></>}
