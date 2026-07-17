/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * reconstruction_source: docs/architecture/SYSTEM_BLUEPRINT_V1.md (business core item 1,
 *   "Enterprise knowledge base"), evidence note citing recovered redirect
 *   ("/app/projects/example-enterprise/knowledge")
 * reconstruction_reason: no original page code recoverable beyond the 7 files already in
 *   recovered/partial-source/
 * original_file_unavailable: true
 *
 * Checkpoint C2: enterprise knowledge base detail view for the CLIENT workspace. Fixture
 * data only (src/app/app/_fixtures.ts) - no real customer data, no database connection.
 * The route param is the item's short human-readable reference code (e.g. "KB-0142"),
 * never a raw UUID or database primary key.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { KNOWLEDGE_PACKAGES } from "../../_fixtures";

export default async function KnowledgeBaseDetailPage({
  params,
}: {
  params: Promise<{ packageId: string }>;
}) {
  const { packageId } = await params;
  const item = KNOWLEDGE_PACKAGES.find((candidate) => candidate.referenceCode === packageId);

  if (!item) {
    notFound();
  }

  return (
    <>
      <header className="cp-page-header">
        <div>
          <p className="eyebrow">
            <Link href="/app/knowledge">企业知识库</Link>
          </p>
          <h1>{item.title}</h1>
          <span>
            {item.category} · 参考编号 {item.referenceCode} · 更新于 {item.updatedLabel} · 关联信源{" "}
            {item.sourceCount} 项
          </span>
        </div>
      </header>
      <section aria-label="详情">
        <p>{item.detail}</p>
      </section>
      <p className="cp-placeholder-note">占位数据 - 无真实客户数据、无数据库连接。</p>
    </>
  );
}
