"use client";
import { AuthorizedProjectWorkspace } from "@/components/agency-runtime";
import { BaiduKeywordProjectPanel } from "@/components/account-keyword-runtime";

export default function Page(){return <><header className="cp-page-header"><div><p className="eyebrow">代理商工作台</p><h1>百度关键词</h1><span>按授权项目查看、筛选并导入真实 CSV/XLSX 关键词资料。</span></div></header><AuthorizedProjectWorkspace>{project=><BaiduKeywordProjectPanel key={project.id} projectId={project.id}/>}</AuthorizedProjectWorkspace></>}
