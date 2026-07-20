/**
 * POST /api/knowledge/packages/[id]/files — accept an uploaded file (filename + contentType +
 * base64 body) and ingest it as a new append-only version under the package.
 *
 * The package must belong to the caller's client organization; otherwise FORBIDDEN. Returns a
 * leak-free ingestion result view (checkpoint KNOWLEDGE_API_V1, Agent D3).
 */
import { apiErr } from "@/runtime/api-contracts/index.js";
import { readJsonBody, toHttpResponse } from "@/runtime/auth/http.js";
import {
  requireOwnedPackage,
  requirePrincipal,
} from "@/runtime/knowledge/http-guards.js";
import {
  decodeBase64,
  ingestIntoPackage,
} from "@/runtime/knowledge/ingest-request.js";
import { getKnowledgeRuntime } from "@/runtime/knowledge/runtime-context.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const rt = getKnowledgeRuntime();
  const { id } = await context.params;

  const principalGuard = await requirePrincipal(rt, request);
  if ("response" in principalGuard) return principalGuard.response;
  const principal = principalGuard.value;

  const pkgGuard = await requireOwnedPackage(rt, principal, id);
  if ("response" in pkgGuard) return pkgGuard.response;
  const pkg = pkgGuard.value;

  const body = await readJsonBody(request);
  const filename = typeof body.filename === "string" ? body.filename : undefined;
  const contentType =
    typeof body.contentType === "string" && body.contentType.trim() !== ""
      ? body.contentType
      : "application/octet-stream";
  const base64 = typeof body.contentBase64 === "string" ? body.contentBase64 : null;
  if (base64 === null) {
    return toHttpResponse(
      apiErr("VALIDATION_FAILED", "A base64-encoded file body (contentBase64) is required."),
    );
  }
  const bytes = decodeBase64(base64);
  if (bytes === null) {
    return toHttpResponse(apiErr("VALIDATION_FAILED", "contentBase64 is not valid base64."));
  }

  const title =
    typeof body.title === "string" && body.title.trim() !== ""
      ? body.title.trim()
      : (filename ?? "").trim();
  if (title === "") {
    return toHttpResponse(
      apiErr("VALIDATION_FAILED", "A document title or filename is required."),
    );
  }

  const result = await ingestIntoPackage(
    rt,
    pkg,
    {
      title,
      filename,
      contentType,
      bytes,
      sourceKind: "FILE",
    },
    { principal, action: "knowledge.document.ingested" },
  );
  return toHttpResponse(result);
}
