"use client";

import { useAsyncData } from "@/components/runtime/index.js";
import type { ArticleDraftCommandViewV1 } from "@/runtime/commands/geo-dto.js";
import { loadArticleDrafts } from "@/components/client-runtime/endpoints.js";

export function ArticleDraftList() {
  const resource = useAsyncData<readonly ArticleDraftCommandViewV1[]>(loadArticleDrafts);
  const { state } = resource;

  return (
    <section className="cp-card">
      <div className="cp-section-header"><div><h2>已编译的草稿</h2></div></div>
      {state.status === "loading" && <p className="cp-placeholder-note">正在加载草稿…</p>}
      {state.status === "error" && (
        <div className="cp-actions">
          <p className="cp-placeholder-note">加载失败。</p>
          <button type="button" className="cp-button" onClick={resource.reload}>重试</button>
        </div>
      )}
      {state.status === "success" && (
        state.data.length === 0
          ? <p className="cp-list-row cp-list-empty">暂无草稿。</p>
          : <ul className="cp-list">
              {state.data.map((draft) => (
                <li className="cp-list-row" key={draft.id}>
                  <span className="cp-list-title">{draft.title}</span>
                  <span className="cp-list-meta">
                    v{draft.version} · {draft.sectionCount} 个章节 · {draft.status} · {new Date(draft.compiledAt).toLocaleString("zh-CN")}
                  </span>
                </li>
              ))}
            </ul>
      )}
    </section>
  );
}
