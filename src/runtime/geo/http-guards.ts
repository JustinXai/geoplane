/**
 * GEO_READ_API_V1 (Agent E4) — shared request guards for the GEO read-side route
 * handlers.
 *
 * Each guard resolves one precondition and returns EITHER the resolved value OR a
 * ready-to-return error Response (mapped through the frozen ApiResponseV1
 * envelope). Routes stay linear: guard, bail on `.response`, continue with
 * `.value`. Mirrors the knowledge lane's http-guards (D3).
 */
import type { Project } from "../../contracts/tenancy/entities.js";
import { apiErr } from "../api-contracts/index.js";
import { toHttpResponse } from "../auth/http.js";
import {
  principalCanReadClientOrganization,
  type GeoPrincipal,
  type GeoRuntime,
} from "./runtime-context.js";

export type Guard<T> = { readonly value: T } | { readonly response: Response };

/** Resolve the session cookie into a principal, or a 401 Response. */
export async function requirePrincipal(
  rt: GeoRuntime,
  request: Request,
): Promise<Guard<GeoPrincipal>> {
  const principal = await rt.resolveSession(request.headers.get("cookie"));
  if (!principal) {
    return {
      response: toHttpResponse(apiErr("UNAUTHENTICATED", "Authentication is required.")),
    };
  }
  return { value: principal };
}

/**
 * Load a project by id and authorize the principal against its owning client
 * organization. An unknown project is 404; a cross-tenant / unauthorized
 * principal is 403.
 */
export async function requireReadableProject(
  rt: GeoRuntime,
  principal: GeoPrincipal,
  projectId: string,
): Promise<Guard<Project>> {
  const project = await rt.tenancy.projects.findById(projectId);
  if (!project) {
    return { response: toHttpResponse(apiErr("NOT_FOUND", "Project not found.")) };
  }
  if (!principalCanReadClientOrganization(principal, project.clientOrganizationId)) {
    return {
      response: toHttpResponse(
        apiErr("FORBIDDEN", "You are not authorized to read this project."),
      ),
    };
  }
  return { value: project };
}
