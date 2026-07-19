"use client";

import { useState } from "react";
import type { ProjectViewV1 } from "../../runtime/api-contracts/index.js";
import { BaiduKeywordProjectPanel } from "../account-keyword-runtime/index.js";
import { useAsyncData } from "../runtime/index.js";
import { AsyncSection } from "./AsyncSection.js";
import { loadProjects } from "./endpoints.js";

export function ClientBaiduKeywordWorkspace() {
  const projects = useAsyncData<readonly ProjectViewV1[]>(loadProjects, { isEmpty: (rows) => rows.length === 0 });
  const [selectedId, setSelectedId] = useState("");
  return <AsyncSection state={projects.state} onRetry={projects.reload} empty={<section className="cp-section"><h2>暂无项目</h2><p>当前账号还没有可访问项目，请联系项目负责人完成项目配置。</p></section>}>
    {(rows) => {
      const selected = rows.find((item) => item.id === selectedId) ?? rows[0];
      if (!selected) return null;
      return <div className="cp-stack">
        <section className="cp-section"><label className="cp-field"><span className="cp-field-label">当前项目</span><select className="cp-input" value={selected.id} onChange={(event) => setSelectedId(event.target.value)}>{rows.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></section>
        <BaiduKeywordProjectPanel key={selected.id} projectId={selected.id} />
      </div>;
    }}
  </AsyncSection>;
}
