/**
 * AGENCY_OPS_WORKSPACE_RUNTIME_V1 (batch 2) — thin, typed endpoint loaders for the OPS (platform)
 * workspace, layered over the frozen api-client (src/lib/api-client). Import-only usage of the
 * client and the frozen DTOs; this lane invents no parallel DTOs. Mirrors the batch-1 agency
 * loaders (src/components/agency-runtime/agency-api.ts): plain async functions, no React, each
 * taking an optional ApiClient so pages use the real fetch-backed client while tests inject a fake.
 *
 * The Ops read routes (Agent C — BUSINESS_COMMAND_API_V1) are PLATFORM_SUPER_ADMIN-only; any other
 * role gets FORBIDDEN and an unauthenticated caller UNAUTHENTICATED — both map to the forbidden UI
 * state (selectAsyncState), so a non-platform principal can never see platform data here.
 */
import type { AuditEventViewV1, ProjectViewV1 } from "../../runtime/api-contracts/index.js";
// Type-only import of the canonical Ops org summary DTO. It lives in the command lane's own
// directory (not the frozen contracts barrel) because it is the exact shape GET /api/ops/
// organizations returns; a type-only import is fully erased at build time, so no server module is
// pulled into the client bundle, and this lane never modifies src/runtime/**.
import type { OrganizationSummaryV1 } from "../../runtime/commands/dto.js";
import { type ApiClient, defaultApiClient, type Result } from "../../lib/api-client/index.js";

export type { OrganizationSummaryV1 };

/**
 * GET /api/ops/organizations — the platform's organization directory: EVERY organization across all
 * three types (PLATFORM/AGENCY/CLIENT), newest first, as OrganizationSummaryV1[]. Route is
 * PLATFORM_SUPER_ADMIN-only; any other role -> FORBIDDEN.
 */
export function listAllOrganizations(
  client: ApiClient = defaultApiClient,
): Promise<Result<readonly OrganizationSummaryV1[]>> {
  return client.request<readonly OrganizationSummaryV1[]>("/api/ops/organizations");
}

/**
 * GET /api/ops/audit — the recent cross-tenant audit trail as AuditEventViewV1[], newest first,
 * with real actor / action / target / timestamp. Route is PLATFORM_SUPER_ADMIN-only. Accepts an
 * optional limit (1..500; the route defaults to 100 and clamps out-of-range values).
 */
export function listOpsAudit(
  options: { readonly limit?: number } = {},
  client: ApiClient = defaultApiClient,
): Promise<Result<readonly AuditEventViewV1[]>> {
  const path =
    options.limit !== undefined
      ? `/api/ops/audit?limit=${encodeURIComponent(String(options.limit))}`
      : "/api/ops/audit";
  return client.request<readonly AuditEventViewV1[]>(path);
}

/**
 * GET /api/projects — the project list the principal may see, as a bare ProjectViewV1[]. Server
 * scopes this to the principal; a PLATFORM admin only sees projects for an explicitly-named client
 * org (else an empty list), so this read never fabricates platform-wide project data.
 */
export function listOpsProjects(
  client: ApiClient = defaultApiClient,
): Promise<Result<readonly ProjectViewV1[]>> {
  return client.request<readonly ProjectViewV1[]>("/api/projects");
}
