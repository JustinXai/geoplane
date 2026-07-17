/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * reconstruction_source: docs/architecture/SYSTEM_BLUEPRINT_V1.md ("client workspace" surface,
 *   business core items 1-4 + post-delivery performance validation)
 * reconstruction_reason: no original page code recoverable beyond the 7 files already in
 *   recovered/partial-source/
 * original_file_unavailable: true
 *
 * Checkpoint C2: real "总览" (project overview) content for the CLIENT workspace
 * landing page, extending the C1 placeholder. Fixture data only (src/app/app/_fixtures.ts) -
 * no real customer data, no database connection. Shows the active project's identity and
 * a stage-count summary, with entry points into the other C2 surfaces.
 */
import Link from "next/link";
import { ACTIVE_PROJECT } from "./_fixtures";

export default function ClientWorkspaceHomePage() {
  return (
    <>
      <header className="cp-page-header">
        <div>
          <p className="eyebrow">客户工作台 · {ACTIVE_PROJECT.clientOrgName}</p>
          <h1>总览</h1>
          <span>
            {ACTIVE_PROJECT.name}（参考编号 {ACTIVE_PROJECT.referenceCode}） ·{" "}
            {ACTIVE_PROJECT.updatedLabel}
          </span>
        </div>
      </header>
      <section aria-label="项目阶段概况" className="cp-card-grid">
        {ACTIVE_PROJECT.stageSummary.map((stage) => (
          <div className="cp-card" key={stage.label}>
            <p className="cp-card-value">{stage.count}</p>
            <p className="cp-card-label">{stage.label}</p>
          </div>
        ))}
      </section>
      <section aria-label="快捷入口">
        <ul>
          <li>
            <Link href="/app/knowledge">进入知识库</Link>
          </li>
          <li>
            <Link href="/app/keywords">进入关键词与用户问题</Link>
          </li>
          <li>
            <Link href="/app/content">进入内容与信源</Link>
          </li>
          <li>
            <Link href="/app/delivery">进入交付中心</Link>
          </li>
          <li>
            <Link href="/app/performance">进入效果验证</Link>
          </li>
        </ul>
      </section>
      <p className="cp-placeholder-note">占位数据 - 无真实客户数据、无数据库连接。</p>
    </>
  );
}
