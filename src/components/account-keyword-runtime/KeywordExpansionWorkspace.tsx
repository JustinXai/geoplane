"use client";

import { useState } from "react";
import { KeywordExpansionHistory } from "./KeywordExpansionHistory.js";
import { KeywordExpansionPanel } from "./KeywordExpansionPanel.js";

export function KeywordExpansionWorkspace({ projectId }: { readonly projectId: string }) {
  const [refreshKey, setRefreshKey] = useState(0);
  return <div className="cp-stack">
    <KeywordExpansionPanel projectId={projectId} onSaved={() => setRefreshKey((value) => value + 1)} />
    <section><h3>已保存的人工审核记录</h3><KeywordExpansionHistory projectId={projectId} refreshKey={refreshKey} /></section>
  </div>;
}
