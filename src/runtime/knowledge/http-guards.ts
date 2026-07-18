/**
 * Shared request guards for the knowledge API route handlers (KNOWLEDGE_API_V1, D3).
 *
 * Each guard resolves one precondition and returns EITHER the resolved value OR a ready-to-return
 * error Response (mapped through the frozen ApiResponseV1 envelope). Routes stay linear: guard,
 * bail on `.response`, continue with `.value`.
 */
import { apiErr } from "../api-contracts/index.js";
import { toHttpResponse } from "../auth/http.js";
import type { KnowledgePackage } from "./entities.js";
import {
  principalOwnsClient,
  type KnowledgePrincipal,
  type KnowledgeRuntime,
} from "./runtime-context.js";

export type Guard<T> = { readonly value: T } | { readonly response: Response };

/** Resolve the session cookie into a principal, or a 401 Response. */
export async function requirePrincipal(
  rt: KnowledgeRuntime,
  request: Request,
): Promise<Guard<KnowledgePrincipal>> {
  const principal = await rt.resolveSession(request.headers.get("cookie"));
  if (!principal) {
    return {
      response: toHttpResponse(apiErr("UNAUTHENTICATED", "Authentication is required.")),
    };
  }
  return { value: principal };
}

/**
 * Load a package by id and authorize the principal against its owning client organization.
 * A missing package is 404; a cross-tenant / unauthorized principal is 403.
 */
export async function requireOwnedPackage(
  rt: KnowledgeRuntime,
  principal: KnowledgePrincipal,
  packageId: string,
): Promise<Guard<KnowledgePackage>> {
  const pkg = await rt.knowledge.packages.findById(packageId);
  if (!pkg) {
    return {
      response: toHttpResponse(apiErr("NOT_FOUND", "Knowledge package not found.")),
    };
  }
  if (!principalOwnsClient(principal, pkg.clientOrganizationId)) {
    return {
      response: toHttpResponse(
        apiErr("FORBIDDEN", "You are not authorized to access this knowledge package."),
      ),
    };
  }
  return { value: pkg };
}
