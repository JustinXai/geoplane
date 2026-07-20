"use client";

/**
 * CLIENT_WORKSPACE_RUNTIME_V1 (Agent D) — 交付中心 (client Delivery Center), wired to real
 * APIs (replaces the C2 fixtures). Resolves the caller's active project, then loads its real
 * delivery rows (GET /api/projects/[projectId]/deliveries). Renders all five async states via
 * the shared AsyncSection.
 *
 * Per SYSTEM_INVARIANTS_V1 "Publication": no default publish/distribution UI. The page keeps
 * the explicit governance notice that channel selection is a manual, opt-in action — never a
 * default — and this checkpoint adds no distribution control that could default to "on".
 *
 * Agent U (p0-u-content-delivery-golden-ui-v1): Extended with draft list and improved status display.
 */
import Link from "next/link";
import { useAsyncData } from "../../../components/runtime/index.js";
import { AsyncSection } from "../../../components/client-runtime/AsyncSection.js";
import { loadActiveProjectDeliveries, loadArticleDrafts } from "../../../components/client-runtime/endpoints.js";
import { isEmptyArray, toDeliveryRows } from "../../../components/client-runtime/view-models.js";
import type { ArticleDraftCommandViewV1 } from "../../../runtime/commands/geo-dto.js";

const DELIVERY_CHANNEL_NOTICE =
  "交付内容不会自动发布到客户网站或任何平台，需人工明确选择渠道后才能启动交付。";

export default function DeliveryCenterPage() {
  const { state: deliveriesState, reload: reloadDeliveries } = useAsyncData(
    loadActiveProjectDeliveries,
    { isEmpty: isEmptyArray },
  );
  const { state: draftsState, reload: reloadDrafts } = useAsyncData(
    loadArticleDrafts,
    { isEmpty: (ds: readonly ArticleDraftCommandViewV1[]) => ds.length === 0 },
  );

  const reload = () => {
    reloadDeliveries();
    reloadDrafts();
  };

  return (
    <>
      <header className="cp-page-header">
        <div>
          <p className="eyebrow">客户工作台</p>
          <h1>交付与报告</h1>
          <span>查看每一篇内容的真实交付状态与发布登记。</span>
        </div>
      </header>
      <p className="cp-callout" role="note">
        {DELIVERY_CHANNEL_NOTICE}
      </p>

      {/* Drafts Section */}
      <section className="cp-delivery-drafts">
        <h2>内容草稿</h2>
        <AsyncSection
          state={draftsState}
          onRetry={reload}
          empty={<p className="cp-placeholder-note">暂无内容草稿。</p>}
        >
          {(drafts) => (
            <ul className="cp-list">
              {drafts.map((draft) => (
                <li className="cp-list-row" key={draft.id}>
                  <span className="cp-list-title">{draft.title}</span>
                  <span className="cp-list-meta">
                    状态：草稿（v{draft.version}） · {draft.sectionCount} 个章节
                  </span>
                  <Link
                    href={`/app/drafts/${encodeURIComponent(draft.id)}`}
                    className="cp-button-brief cp-button-inline"
                  >
                    查看详情
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </AsyncSection>
      </section>

      {/* Deliveries Section */}
      <section className="cp-delivery-results">
        <h2>已交付内容</h2>
        <AsyncSection
          state={deliveriesState}
          onRetry={reload}
          empty={<p className="cp-list-row cp-list-empty">暂无已交付内容。</p>}
        >
          {(rows) => (
            <ul className="cp-list">
              {toDeliveryRows(rows).map((row, index) => (
                <li className="cp-list-row" key={`${row.title}-${index}`}>
                  <span className="cp-list-title">{row.title}</span>
                  <span className="cp-list-meta">
                    状态：{row.statusLabel}
                    {row.deliveredAtLabel !== "—" ? ` · 交付于 ${row.deliveredAtLabel}` : ""}
                    {row.publicationRegisteredAtLabel !== null
                      ? ` · 发布登记于 ${row.publicationRegisteredAtLabel}`
                      : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </AsyncSection>
      </section>
    </>
  );
}
