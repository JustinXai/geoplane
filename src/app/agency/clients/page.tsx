"use client";

/**
 * AGENCY_OPS_WORKSPACE_RUNTIME_V1 (batch 1) — 客户 (authorized client list) for the AGENCY
 * workspace, wired to the REAL API (GET /api/agency/clients), replacing fixtures.
 *
 * Assignment isolation: the list is exactly what GET /api/agency/clients returns — ONLY the
 * agency's ACTIVE-assigned clients. Client search only narrows that authorized set (never widens
 * it), so an unauthorized client can never appear or be selected here.
 *
 * Acting context + no impersonation: selecting a client POSTs /api/agency/context; on success the
 * returned AgencyActingContextV1 is written into the shared acting-context store, so the
 * persistent banner rendered ONCE by the agency layout (AgencyActingBannerMount) shows the agency
 * as the real actor and the client as the subject across every agency page. An unauthorized
 * selection returns FORBIDDEN and sets no context (no banner). This is a read-only preview surface
 * — no client-facing write actions are wired.
 */
import { useState } from "react";
import { useAsyncData } from "@/components/runtime";
import {
  AgencyAsyncView,
  filterAuthorizedClients,
  getAgencyClients,
  isPortfolioEmpty,
  resolveClientSelection,
  setAgencyContext,
  useActingContext,
} from "@/components/agency-runtime";
import type { AgencyClientPortfolioViewV1 } from "@/runtime/api-contracts";
import type { ApiErrorCodeV1 } from "@/runtime/api-contracts";

export default function AgencyClientsPage() {
  const { state } = useAsyncData<AgencyClientPortfolioViewV1>(() => getAgencyClients(), {
    isEmpty: isPortfolioEmpty,
  });
  const { setActingContext } = useActingContext();

  const [query, setQuery] = useState("");
  const [pending, setPending] = useState(false);
  const [actingError, setActingError] = useState<
    { readonly code: ApiErrorCodeV1; readonly message: string } | undefined
  >(undefined);

  async function selectClient(
    portfolio: AgencyClientPortfolioViewV1,
    clientOrganizationId: string,
  ): Promise<void> {
    // Defence-in-depth: never even offer to act for a client outside the authorized set. The
    // server independently returns FORBIDDEN via POST /api/agency/context.
    const selection = resolveClientSelection(portfolio, clientOrganizationId);
    if (!selection.authorized) {
      setActingContext(null);
      setActingError({
        code: "FORBIDDEN",
        message: "该客户不在当前有效分配范围内，无法切换。",
      });
      return;
    }
    setPending(true);
    setActingError(undefined);
    const result = await setAgencyContext(clientOrganizationId);
    if (result.ok) {
      // Drives the persistent banner mounted once in the agency layout.
      setActingContext(result.data);
    } else {
      setActingContext(null);
      setActingError({ code: result.code, message: result.message });
    }
    setPending(false);
  }

  return (
    <>
      <header className="cp-page-header">
        <div>
          <p className="eyebrow">代理商工作台</p>
          <h1>客户</h1>
          <span>仅显示当前有效分配（ACTIVE）中的客户；选择客户后可代其查看内容。</span>
        </div>
      </header>

      {actingError !== undefined ? (
        <p className="cp-callout" role="alert">
          切换客户失败：{actingError.message}
        </p>
      ) : null}
      {pending ? (
        <p className="cp-placeholder-note" role="status" aria-live="polite">
          正在切换客户身份…
        </p>
      ) : null}

      <AgencyAsyncView<AgencyClientPortfolioViewV1>
        state={state}
        empty={<p className="cp-list-row cp-list-empty">尚无授权客户 - 暂无任何有效分配。</p>}
      >
        {(portfolio) => {
          const clients = filterAuthorizedClients(portfolio, query);
          return (
            <section className="cp-section">
              <label className="cp-field">
                <span className="cp-field-label">搜索客户</span>
                <input
                  className="cp-input"
                  type="search"
                  value={query}
                  placeholder="按客户名称或编号搜索"
                  onChange={(e) => setQuery(e.target.value)}
                  aria-label="搜索客户"
                />
              </label>
              <ul className="cp-list">
                {clients.map((client) => (
                  <li className="cp-list-row" key={client.clientOrganizationId}>
                    <span className="cp-list-title">{client.clientOrganizationName}</span>
                    <span className="cp-list-meta">
                      编号 {client.clientOrganizationId} · 项目 {client.projectCount} 个 · 待审核{" "}
                      {client.openReviewCount} 项
                    </span>
                    <button
                      type="button"
                      className="cp-button"
                      disabled={pending}
                      onClick={() => selectClient(portfolio, client.clientOrganizationId)}
                    >
                      代此客户查看
                    </button>
                  </li>
                ))}
                {clients.length === 0 ? (
                  <li className="cp-list-row cp-list-empty">无匹配客户。</li>
                ) : null}
              </ul>
            </section>
          );
        }}
      </AgencyAsyncView>
    </>
  );
}
