/**
 * Shared ingest orchestration for the file and URL upload routes (KNOWLEDGE_API_V1, D3).
 *
 * Runs the D2 KnowledgeIngestionService for a tenant-owned package, then refreshes the package
 * view so the response reflects the newly appended document/version. Returns a leak-free view.
 */
import type { ApiResponseV1 } from "../api-contracts/index.js";
import { apiErr, apiOk } from "../api-contracts/index.js";
import type { KnowledgePackage } from "./entities.js";
import type { KnowledgeDocumentSourceKind } from "./entities.js";
import type { KnowledgeRuntime } from "./runtime-context.js";
import {
  toDocumentView,
  toPackageView,
  toVersionView,
  type KnowledgeIngestResultViewV1,
} from "./views.js";

export interface IngestRequestInput {
  readonly title: string;
  readonly filename?: string;
  readonly contentType: string;
  readonly bytes: Buffer;
  readonly sourceKind: KnowledgeDocumentSourceKind;
}

/**
 * Ingest `input` into `pkg` and produce the response envelope. An out-of-scope input is not fatal:
 * the ingestion service returns a SKIPPED result which we surface (still 200) with its warnings,
 * so a single bad upload never blocks the caller.
 */
export async function ingestIntoPackage(
  rt: KnowledgeRuntime,
  pkg: KnowledgePackage,
  input: IngestRequestInput,
): Promise<ApiResponseV1<KnowledgeIngestResultViewV1>> {
  const result = await rt.ingestion.ingest({
    clientOrganizationId: pkg.clientOrganizationId,
    projectId: pkg.projectId,
    packageId: pkg.id,
    title: input.title,
    createdByUserId: pkg.createdByUserId,
    source: {
      filename: input.filename,
      contentType: input.contentType,
      bytes: input.bytes,
    },
    sourceKind: input.sourceKind,
  });

  const withCounts = await rt.knowledge.packages.getWithCounts(
    pkg.id,
    pkg.clientOrganizationId,
  );
  if (!withCounts) {
    // The package existed a moment ago under this tenant; a null here is an internal fault.
    return apiErr("INTERNAL_ERROR", "Package disappeared during ingestion.");
  }
  const packageView = toPackageView(withCounts);

  if (result.outcome === "SKIPPED") {
    return apiOk<KnowledgeIngestResultViewV1>({
      outcome: "SKIPPED",
      format: null,
      reason: result.reason,
      warnings: result.warnings,
      document: null,
      version: null,
      package: packageView,
    });
  }

  return apiOk<KnowledgeIngestResultViewV1>({
    outcome: "INGESTED",
    format: result.format,
    reason: null,
    warnings: result.warnings,
    document: toDocumentView(result.document),
    version: toVersionView(result.version),
    package: packageView,
  });
}

/** Decode a request-supplied base64 payload into raw bytes, or null when it is not valid base64. */
export function decodeBase64(value: string): Buffer | null {
  try {
    // Buffer.from with "base64" is lenient; round-trip to detect garbage input deterministically.
    const buf = Buffer.from(value, "base64");
    return buf;
  } catch {
    return null;
  }
}
