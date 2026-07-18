/**
 * POST /api/knowledge/packages/[id]/urls — ingest a URL document. The caller supplies the URL plus
 * the ALREADY-fetched HTML bytes (base64); this route performs NO network I/O. The HTML is parsed
 * to text and appended as a new version.
 *
 * The package must belong to the caller's client organization; otherwise FORBIDDEN. Returns a
 * leak-free ingestion result view (checkpoint KNOWLEDGE_API_V1, Agent D3).
 */
import { apiErr } from "../../../../../../runtime/api-contracts/index.js";
import { readJsonBody, toHttpResponse } from "../../../../../../runtime/auth/http.js";
import {
  requireOwnedPackage,
  requirePrincipal,
} from "../../../../../../runtime/knowledge/http-guards.js";
import {
  decodeBase64,
  ingestIntoPackage,
} from "../../../../../../runtime/knowledge/ingest-request.js";
import { getKnowledgeRuntime } from "../../../../../../runtime/knowledge/runtime-context.js";

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
  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (url === "") {
    return toHttpResponse(apiErr("VALIDATION_FAILED", "A url is required."));
  }
  const base64 = typeof body.contentBase64 === "string" ? body.contentBase64 : null;
  if (base64 === null) {
    return toHttpResponse(
      apiErr(
        "VALIDATION_FAILED",
        "The fetched page bytes (contentBase64) are required; this route does not fetch URLs.",
      ),
    );
  }
  const bytes = decodeBase64(base64);
  if (bytes === null) {
    return toHttpResponse(apiErr("VALIDATION_FAILED", "contentBase64 is not valid base64."));
  }

  const contentType =
    typeof body.contentType === "string" && body.contentType.trim() !== ""
      ? body.contentType
      : "text/html";
  const title =
    typeof body.title === "string" && body.title.trim() !== "" ? body.title.trim() : url;

  const result = await ingestIntoPackage(
    rt,
    pkg,
    {
      title,
      filename: url,
      contentType,
      bytes,
      sourceKind: "URL",
    },
    { principal, action: "knowledge.url.ingested" },
  );
  return toHttpResponse(result);
}
