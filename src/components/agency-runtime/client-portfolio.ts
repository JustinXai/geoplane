/**
 * AGENCY_OPS_WORKSPACE_RUNTIME_V1 (batch 1) — pure, React-free logic for the AGENCY authorized
 * client list + client search, and the assignment-isolation guard.
 *
 * CRITICAL isolation invariant (SYSTEM_INVARIANTS_V1 "Tenant isolation"): an agency may only
 * see / act on CLIENT organizations it has an explicit, ACTIVE assignment to. GET /api/agency/
 * clients already returns ONLY that active set, so `portfolio.clients` IS the authorized set by
 * construction — every function below treats it as the sole source of truth and never widens it.
 * A client id absent from the portfolio is, by definition, unauthorized.
 */
import type {
  AgencyClientPortfolioItemV1,
  AgencyClientPortfolioViewV1,
} from "../../runtime/api-contracts/index.js";

/** True when the loaded portfolio contains no authorized clients (drives the Empty state). */
export function isPortfolioEmpty(portfolio: AgencyClientPortfolioViewV1): boolean {
  return portfolio.clients.length === 0;
}

/**
 * The authorized clients matching an optional case-insensitive search over org name + id.
 * Never reaches outside `portfolio.clients` (the ACTIVE-assigned set), so search can only ever
 * narrow the authorized list — it can never surface an unassigned client.
 */
export function filterAuthorizedClients(
  portfolio: AgencyClientPortfolioViewV1,
  query = "",
): readonly AgencyClientPortfolioItemV1[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return portfolio.clients;
  return portfolio.clients.filter(
    (c) =>
      c.clientOrganizationName.toLowerCase().includes(needle) ||
      c.clientOrganizationId.toLowerCase().includes(needle),
  );
}

/** Whether a client id is within the agency's authorized (ACTIVE-assigned) portfolio. */
export function isClientAuthorized(
  portfolio: AgencyClientPortfolioViewV1,
  clientOrganizationId: string,
): boolean {
  return portfolio.clients.some((c) => c.clientOrganizationId === clientOrganizationId);
}

/** The authorized portfolio entry for a client id, or undefined if it is not authorized. */
export function findAuthorizedClient(
  portfolio: AgencyClientPortfolioViewV1,
  clientOrganizationId: string,
): AgencyClientPortfolioItemV1 | undefined {
  return portfolio.clients.find((c) => c.clientOrganizationId === clientOrganizationId);
}

/**
 * Client-selection outcome, computed BEFORE any acting-context POST so the UI never even offers
 * to act for an unauthorized client. The server independently enforces the same rule (POST
 * /api/agency/context returns FORBIDDEN), so this is defence-in-depth, not the only gate.
 */
export type ClientSelection =
  | { readonly authorized: true; readonly client: AgencyClientPortfolioItemV1 }
  | { readonly authorized: false; readonly clientOrganizationId: string };

export function resolveClientSelection(
  portfolio: AgencyClientPortfolioViewV1,
  clientOrganizationId: string,
): ClientSelection {
  const client = findAuthorizedClient(portfolio, clientOrganizationId);
  return client !== undefined
    ? { authorized: true, client }
    : { authorized: false, clientOrganizationId };
}
