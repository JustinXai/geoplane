"use client";

/**
 * AGENCY_OPS_WORKSPACE_RUNTIME_V1 (batch 1) — 交付包 (delivery packages) for the AGENCY
 * workspace, wired to the REAL API, replacing fixtures.
 *
 * Read-only preview across the agency's authorized projects: loads GET /api/projects (scoped
 * server-side to ACTIVE-assigned clients) then GET /api/projects/[id]/deliveries per project, so
 * no unauthorized client's deliveries can appear. No auto-publish and no write actions are wired
 * — this is a preview surface only.
 */
import { useAsyncData } from "@/components/runtime";
import {
  type AgencyProjectReadGroup,
  AgencyAsyncView,
  isAggregateEmpty,
  listClientDeliveries,
  loadAgencyProjectReads,
} from "@/components/agency-runtime";
import type { ArticleDeliveryViewV1 } from "@/runtime/api-contracts";

type DeliveryGroups = readonly AgencyProjectReadGroup<ArticleDeliveryViewV1>[];

export default function AgencyDeliveryPackagesPage() {
  const { state } = useAsyncData<DeliveryGroups>(
    () => loadAgencyProjectReads<ArticleDeliveryViewV1>(listClientDeliveries),
    { isEmpty: isAggregateEmpty },
  );

  return (
    <>
      <header className="cp-page-header">
        <div>
          <p className="eyebrow">代理商工作台</p>
          <h1>交付包</h1>
          <span>授权客户项目的交付内容只读预览；不触发任何自动发布。</span>
        </div>
      </header>

      <AgencyAsyncView<DeliveryGroups>
        state={state}
        empty={<p className="cp-list-row cp-list-empty">暂无交付内容。</p>}
      >
        {(groups) =>
          groups.map((group) => (
            <section className="cp-section" key={group.project.id}>
              <h2>
                {group.project.name}{" "}
                <span className="cp-list-meta">
                  （{group.project.clientOrganizationName}）
                </span>
              </h2>
              <ul className="cp-list">
                {group.items.map((delivery) => (
                  <li className="cp-list-row" key={delivery.id}>
                    <span className="cp-list-title">{delivery.title}</span>
                    <span className="cp-list-meta">
                      状态：{delivery.status} · 交付时间：{delivery.deliveredAt ?? "未交付"} ·
                      发布登记：{delivery.publicationRegisteredAt ?? "未登记"}
                    </span>
                  </li>
                ))}
                {group.items.length === 0 ? (
                  <li className="cp-list-row cp-list-empty">该项目暂无交付内容。</li>
                ) : null}
              </ul>
            </section>
          ))
        }
      </AgencyAsyncView>
    </>
  );
}
