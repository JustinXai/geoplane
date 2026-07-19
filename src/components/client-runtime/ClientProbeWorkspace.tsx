"use client";

import { useState } from "react";
import { ManualProbeWorkspace } from "../probe-report/index.js";
import { useAsyncData } from "../runtime/index.js";
import { getManualProbeEntryOptions } from "../../lib/api-client/domestic.js";
import { AsyncSection } from "./AsyncSection.js";

export function ClientProbeWorkspace() {
  const resource = useAsyncData(getManualProbeEntryOptions, { isEmpty: (value) => value.projects.length === 0 });
  const [selectedIndex, setSelectedIndex] = useState(0);
  return <AsyncSection state={resource.state} onRetry={resource.reload} empty={<p className="cp-list-row cp-list-empty">暂无可执行人工查询的项目。</p>}>{(data) => {
    const project = data.projects[selectedIndex] ?? data.projects[0]; if (!project) return null;
    return <div className="cp-stack">{data.projects.length > 1 ? <label className="cp-field">当前项目<select value={selectedIndex} onChange={(event) => setSelectedIndex(Number(event.target.value))}>{data.projects.map((item, index) => <option key={item.projectId} value={index}>{item.projectName}</option>)}</select></label> : <p>当前项目：{project.projectName}</p>}<ManualProbeWorkspace projectId={project.projectId} questions={project.questions.map((item) => item.question)} /><p className="cp-callout">仅支持人工录入与查看真实样本；不自动登录、不批量执行，也不调用内容生成服务。</p></div>;
  }}</AsyncSection>;
}
