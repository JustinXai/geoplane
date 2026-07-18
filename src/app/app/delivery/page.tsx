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
 */
import { useAsyncData } from "../../../components/runtime/index.js";
import { AsyncSection } from "../../../components/client-runtime/AsyncSection.js";
import { loadActiveProjectDeliveries } from "../../../components/client-runtime/endpoints.js";
import { isEmptyArray, toDeliveryRows } from "../../../components/client-runtime/view-models.js";

const DELIVERY_CHANNEL_NOTICE =
  "交付内容不会自动发布到客户网站或任何平台，需人工明确选择渠道后才能启动交付。";

export default function DeliveryCenterPage() {
  const { state, reload } = useAsyncData(loadActiveProjectDeliveries, { isEmpty: isEmptyArray });

  return (
    <>
      <header className="cp-page-header">
        <div>
          <p className="eyebrow">客户工作台</p>
          <h1>交付中心</h1>
          <span>每一篇内容的交付状态。</span>
        </div>
      </header>
      <p className="cp-callout" role="note">
        {DELIVERY_CHANNEL_NOTICE}
      </p>
      <AsyncSection
        state={state}
        onRetry={reload}
        empty={<p className="cp-list-row cp-list-empty">暂无待交付内容。</p>}
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
    </>
  );
}
