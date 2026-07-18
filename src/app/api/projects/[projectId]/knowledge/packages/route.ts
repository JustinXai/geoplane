/**
 * POST /api/projects/[projectId]/knowledge/packages — create a knowledge package under a project.
 *
 * The project must be owned by the caller's client organization; otherwise FORBIDDEN. Returns the
 * new KnowledgePackageViewV1 (checkpoint KNOWLEDGE_API_V1, Agent D3).
 */
import { apiErr, apiOk } from "../../../../../../runtime/api-contracts/index.js";
import { readJsonBody, toHttpResponse } from "../../../../../../runtime/auth/http.js";
import { requirePrincipal } from "../../../../../../runtime/knowledge/http-guards.js";
import {
  getKnowledgeRuntime,
  principalOwnsClient,
} from "../../../../../../runtime/knowledge/runtime-context.js";
import { newPackageView } from "../../../../../../runtime/knowledge/views.js";
import type { KnowledgeClassification } from "../../../../../../runtime/knowledge/entities.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CLASSIFICATIONS: readonly KnowledgeClassification[] = [
  "PUBLIC",
  "INTERNAL",
  "CONFIDENTIAL",
  "RESTRICTED",
];

function parseClassification(value: unknown): KnowledgeClassification | undefined {
  return typeof value === "string" &&
    (CLASSIFICATIONS as readonly string[]).includes(value)
    ? (value as KnowledgeClassification)
    : undefined;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
): Promise<Response> {
  const rt = getKnowledgeRuntime();
  const { projectId } = await context.params;

  const guard = await requirePrincipal(rt, request);
  if ("response" in guard) return guard.response;
  const principal = guard.value;

  const body = await readJsonBody(request);
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (title === "") {
    return toHttpResponse(apiErr("VALIDATION_FAILED", "A package title is required."));
  }

  const project = await rt.projects.findById(projectId);
  if (!project) {
    return toHttpResponse(apiErr("NOT_FOUND", "Project not found."));
  }
  if (!principalOwnsClient(principal, project.clientOrganizationId)) {
    return toHttpResponse(
      apiErr("FORBIDDEN", "You are not authorized to create packages in this project."),
    );
  }

  const pkg = await rt.knowledge.packages.create({
    clientOrganizationId: project.clientOrganizationId,
    projectId: project.id,
    title,
    createdByUserId: principal.userId,
    classification: parseClassification(body.classification),
  });

  return toHttpResponse(apiOk(newPackageView(pkg)), { okStatus: 201 });
}
