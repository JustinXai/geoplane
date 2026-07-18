/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC (net-new runtime-phase file)
 * reconstruction_source: ../ports.ts (KnowledgeDocumentRepository, KnowledgeVersionRepository),
 *   ../entities.ts, ./parsers.ts, ./content-store.ts, migrations/0002_knowledge_runtime.sql
 *   (append-only knowledge_version; current_version_number is bumped atomically by the repo).
 * reconstruction_reason: KNOWLEDGE_FILE_INGESTION_V1 - the pipeline that turns an uploaded
 *   file (or fetched HTML) into a new append-only knowledge_version under a package. Finds or
 *   creates the document by (package, title), stores the extracted text behind the content
 *   store, and appends the next version via the D1 ports (version_number increments; prior
 *   versions are never overwritten). Tenant/project scope is carried from the caller onto the
 *   document; the version repo inherits it from the document row. Deterministic: the same text
 *   yields the same content hash and the same content-addressed storage path.
 * original_file_unavailable: n/a (net-new runtime-phase file)
 *
 * Client-surface safety: extracted text is internal. This service returns the persisted
 * KnowledgeDocument/KnowledgeVersion entities (which hold only a hash + storage reference,
 * never the text) plus the detected format and warnings. It never surfaces chunk / embedding /
 * artifact-hash / schema shapes.
 */
import { createHash } from "node:crypto";
import type {
  KnowledgeDocument,
  KnowledgeDocumentSourceKind,
  KnowledgeVersion,
} from "../entities.js";
import type {
  KnowledgeDocumentRepository,
  KnowledgeVersionRepository,
} from "../ports.js";
import type { KnowledgeContentStore } from "./content-store.js";
import {
  UnsupportedKnowledgeFormatError,
  type KnowledgeParseFormat,
  type KnowledgeParseInput,
  type KnowledgeParser,
} from "./parsers.js";

export interface IngestKnowledgeFileInput {
  readonly clientOrganizationId: string;
  readonly projectId: string;
  readonly packageId: string;
  /** Stable document identity within the package; a re-upload under the same title versions it. */
  readonly title: string;
  readonly createdByUserId: string;
  /** The raw source to parse (bytes + contentType + optional filename). */
  readonly source: KnowledgeParseInput;
  /** Defaults to "FILE"; pass "URL" for fetched-HTML documents, etc. */
  readonly sourceKind?: KnowledgeDocumentSourceKind;
}

/** A file was parsed and appended as a new version. */
export interface IngestedResult {
  readonly outcome: "INGESTED";
  readonly document: KnowledgeDocument;
  readonly version: KnowledgeVersion;
  readonly format: KnowledgeParseFormat;
  readonly warnings: readonly string[];
}

/** An out-of-scope input (OCR/spreadsheet/unknown) - recorded, not fatal. */
export interface SkippedResult {
  readonly outcome: "SKIPPED";
  readonly reason: string;
  readonly warnings: readonly string[];
}

export type IngestKnowledgeFileResult = IngestedResult | SkippedResult;

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export class KnowledgeIngestionService {
  constructor(
    private readonly parser: KnowledgeParser,
    private readonly documents: KnowledgeDocumentRepository,
    private readonly versions: KnowledgeVersionRepository,
    private readonly contentStore: KnowledgeContentStore,
  ) {}

  /**
   * Parse `input.source` and append the extracted text as the next version of the
   * (package, title) document, creating the document on first ingest. Out-of-scope inputs
   * return a SKIPPED result with a warning instead of throwing, so a bulk upload is never
   * blocked by one bad file.
   */
  async ingest(input: IngestKnowledgeFileInput): Promise<IngestKnowledgeFileResult> {
    let parsed;
    try {
      parsed = await this.parser.parse(input.source);
    } catch (err) {
      if (err instanceof UnsupportedKnowledgeFormatError) {
        return { outcome: "SKIPPED", reason: err.reason, warnings: [err.message] };
      }
      throw err;
    }

    const document = await this.findOrCreateDocument(input);

    const contentHash = sha256Hex(parsed.text);
    const byteSize = Buffer.byteLength(parsed.text, "utf8");
    // Content-addressed, deterministic path scoped to tenant-owned package + document.
    const storagePath = `knowledge/${input.packageId}/${document.id}/${contentHash}`;
    await this.contentStore.put(storagePath, parsed.text);

    // Append-only: addVersion computes the next version_number and bumps the document's
    // current_version_number atomically; it never overwrites a prior version row.
    const version = await this.versions.addVersion({
      documentId: document.id,
      contentHash,
      createdByUserId: input.createdByUserId,
      storagePath,
      byteSize,
      mimeType: input.source.contentType,
    });

    return {
      outcome: "INGESTED",
      document,
      version,
      format: parsed.format,
      warnings: parsed.warnings,
    };
  }

  private async findOrCreateDocument(
    input: IngestKnowledgeFileInput,
  ): Promise<KnowledgeDocument> {
    const existing = (await this.documents.listByPackage(input.packageId)).find(
      (d) => d.title === input.title,
    );
    if (existing) return existing;
    return this.documents.create({
      clientOrganizationId: input.clientOrganizationId,
      projectId: input.projectId,
      packageId: input.packageId,
      title: input.title,
      createdByUserId: input.createdByUserId,
      sourceKind: input.sourceKind ?? "FILE",
    });
  }
}
