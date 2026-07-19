"use client";
import { useAsyncData } from "@/components/runtime";
import { AgencyAsyncView, AuthorizedProjectWorkspace } from "@/components/agency-runtime";
import { BaiduKeywordImportPanel } from "@/components/account-keyword-runtime";
import { getBaiduKeywordOverview } from "@/lib/api-client/domestic";
import type { BaiduKeywordReadModel } from "@/runtime/read-models/domestic-workspaces";

function ProjectKeywords({projectId}:{projectId:string}){const {state,reload}=useAsyncData<BaiduKeywordReadModel>(()=>getBaiduKeywordOverview(projectId),{deps:[projectId]});return <div className="cp-stack"><AgencyAsyncView state={state}>{data=><section className="cp-section"><h2>真实关键词概览</h2><p>导入批次 {data.imports.length} 个 · 规范化关键词 {data.keywords.length} 条</p>{data.keywords.length===0?<p className="cp-placeholder-note">该项目尚未导入关键词。</p>:<div className="cp-table-wrap"><table className="cp-data-table"><thead><tr><th>关键词</th><th>规范化结果</th><th>需求数据</th><th>观察时间</th></tr></thead><tbody>{data.keywords.slice(0,100).map(row=><tr key={row.id}><td>{row.rawKeyword}</td><td>{row.normalizedKeyword}</td><td>{row.demandValue===null?"无已验证数据":row.demandValue}</td><td>{new Date(row.observedAt).toLocaleString("zh-CN")}</td></tr>)}</tbody></table></div>}<p className="cp-placeholder-note">仅展示真实入库记录；缺失的百度指标不会推测补齐。</p></section>}</AgencyAsyncView><section className="cp-section"><h2>导入百度关键词文件</h2><BaiduKeywordImportPanel projectId={projectId} onImported={reload}/></section></div>}
export default function Page(){return <><header className="cp-page-header"><div><p className="eyebrow">代理商工作台</p><h1>百度关键词</h1><span>按授权项目查看并导入真实 CSV/XLSX 关键词资料。</span></div></header><AuthorizedProjectWorkspace>{project=><ProjectKeywords key={project.id} projectId={project.id}/>}</AuthorizedProjectWorkspace></>}
