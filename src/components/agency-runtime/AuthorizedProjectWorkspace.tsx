"use client";

import { useState, type ReactNode } from "react";
import { useAsyncData } from "@/components/runtime";
import type { ProjectViewV1 } from "@/runtime/api-contracts";
import { AgencyAsyncView } from "./AgencyAsyncView.js";
import { listAgencyProjects } from "./agency-api.js";

export function AuthorizedProjectWorkspace({ children }: { readonly children: (project: ProjectViewV1) => ReactNode }) {
  const { state } = useAsyncData<readonly ProjectViewV1[]>(() => listAgencyProjects(), { isEmpty: (rows) => rows.length === 0 });
  const [selectedId, setSelectedId] = useState("");
  return <AgencyAsyncView state={state} empty={<p className="cp-placeholder-note">当前没有已授权项目。</p>}>
    {(projects) => {
      const selected = projects.find((project) => project.id === selectedId) ?? projects[0];
      if (!selected) return <p className="cp-placeholder-note">当前没有已授权项目。</p>;
      return <div className="cp-stack">
        <section className="cp-section"><label className="cp-field"><span className="cp-field-label">当前操作项目</span>
          <select className="cp-input" value={selected.id} onChange={(event) => setSelectedId(event.target.value)}>
            {projects.map((project) => <option key={project.id} value={project.id}>{project.clientOrganizationName} · {project.name}</option>)}
          </select>
        </label><p className="cp-placeholder-note">这里只列出当前代理商已获授权客户的项目。</p></section>
        {children(selected)}
      </div>;
    }}
  </AgencyAsyncView>;
}
