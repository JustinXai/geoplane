/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * reconstruction_source: docs/architecture/SYSTEM_BLUEPRINT_V1.md (business core item 1,
 *   "Enterprise knowledge base"), evidence note citing recovered redirect
 *   ("/app/projects/example-enterprise/knowledge")
 * reconstruction_reason: no original page code recoverable beyond the 7 files already in
 *   recovered/partial-source/
 * original_file_unavailable: true
 *
 * Checkpoint C2: enterprise knowledge base list view for the CLIENT workspace. Fixture
 * data only (src/app/app/_fixtures.ts) - no real customer data, no database connection.
 * Each row links to a fixture detail view at /app/knowledge/[referenceCode]. Reference
 * codes are short human-readable labels (e.g. "KB-0142"), never raw UUIDs.
 */
import Link from "next/link";
import { KNOWLEDGE_PACKAGES } from "../_fixtures";

export default function KnowledgeBasePage() {
  return (
    <>
      <header className="cp-page-header">
        <div>
          <p className="eyebrow">客户工作台</p>
          <h1>企业知识库</h1>
          <span>占位数据 - 无真实客户数据、无数据库连接。</span>
        </div>
      </header>
      <ul className="cp-list">
        {KNOWLEDGE_PACKAGES.map((item) => (
          <li className="cp-list-row" key={item.referenceCode}>
            <Link href={`/app/knowledge/${item.referenceCode}`}>
              <span className="cp-list-title">{item.title}</span>
              <span className="cp-list-meta">
                {item.category} · 参考编号 {item.referenceCode} · 更新于 {item.updatedLabel}
              </span>
              <span className="cp-list-summary">{item.summary}</span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
