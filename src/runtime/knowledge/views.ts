/**
 * Entity -> frozen-DTO mappers for the knowledge API routes (checkpoint KNOWLEDGE_API_V1, D3).
 *
 * Client-surface safety is enforced here: these mappers copy ONLY the human-facing fields the
 * frozen DTOs declare. Storage-internal facts — chunk/embedding vectors, artifact/content hashes,
 * schema shapes and storage_path — are never read into a view. The ingestion-result view below
 * likewise surfaces version_number / byte size / mime type but never the content hash or the
 * content-addressed storage path.
 */
import type {
  KnowledgeIssueViewV1,
  KnowledgePackageViewV1,
} from "../api-contracts/index.js";
import type {
  KnowledgeClassification,
  KnowledgeDocument,
  KnowledgeIssue,
  KnowledgePackage,
  KnowledgePackageWithCounts,
  KnowledgeSnapshot,
  KnowledgeVersion,
} from "./entities.js";
import type { KnowledgeParseFormat } from "./ingestion/parsers.js";

/** Map a package (with counts) to the frozen KnowledgePackageViewV1. */
export function toPackageView(
  pkg: KnowledgePackageWithCounts,
): KnowledgePackageViewV1 {
  return {
    id: pkg.id,
    projectId: pkg.projectId,
    title: pkg.title,
    status: pkg.status,
    documentCount: pkg.documentCount,
    openIssueCount: pkg.openIssueCount,
    updatedAt: pkg.updatedAt,
    confirmedAt: pkg.confirmedAt,
  };
}

/** Map a freshly created package (no documents/issues yet) to the frozen view. */
export function newPackageView(pkg: KnowledgePackage): KnowledgePackageViewV1 {
  return {
    id: pkg.id,
    projectId: pkg.projectId,
    title: pkg.title,
    status: pkg.status,
    documentCount: 0,
    openIssueCount: 0,
    updatedAt: pkg.updatedAt,
    confirmedAt: pkg.confirmedAt,
  };
}

/** Map a knowledge issue to the frozen KnowledgeIssueViewV1. */
export function toIssueView(issue: KnowledgeIssue): KnowledgeIssueViewV1 {
  return {
    id: issue.id,
    packageId: issue.packageId,
    kind: issue.kind,
    severity: issue.severity,
    message: issue.message,
    resolved: issue.resolved,
  };
}

/**
 * Human-facing snapshot facts. Leak-free: the sealed contentHash and the client-org id are
 * storage/tenant internals and are deliberately NOT surfaced (mirrors the ingest-result view,
 * which likewise hides the content hash).
 */
export interface KnowledgeSnapshotViewV1 {
  readonly id: string;
  readonly packageId: string;
  readonly snapshotNumber: number;
  readonly documentCount: number;
  readonly classification: KnowledgeClassification;
  /** null = current/active snapshot; set once a newer snapshot supersedes it. */
  readonly supersededAt: string | null;
  readonly createdAt: string;
}

/** Map a sealed snapshot to its leak-free view. */
export function toSnapshotView(snapshot: KnowledgeSnapshot): KnowledgeSnapshotViewV1 {
  return {
    id: snapshot.id,
    packageId: snapshot.packageId,
    snapshotNumber: snapshot.snapshotNumber,
    documentCount: snapshot.documentCount,
    classification: snapshot.classification,
    supersededAt: snapshot.supersededAt,
    createdAt: snapshot.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Ingestion result view (no frozen DTO exists; defined here, leak-free)
// ---------------------------------------------------------------------------

/** Human-facing document facts (no storage/hash internals). */
export interface KnowledgeDocumentViewV1 {
  readonly id: string;
  readonly title: string;
  readonly sourceKind: KnowledgeDocument["sourceKind"];
  readonly currentVersionNumber: number;
}

/** Human-facing version facts (version number + size/type; NO content hash, NO storage path). */
export interface KnowledgeVersionViewV1 {
  readonly versionNumber: number;
  readonly byteSize: number | null;
  readonly mimeType: string | null;
  readonly createdAt: string;
}

/** The response body for a file/url ingestion request. */
export interface KnowledgeIngestResultViewV1 {
  readonly outcome: "INGESTED" | "SKIPPED";
  readonly format: KnowledgeParseFormat | null;
  readonly reason: string | null;
  readonly warnings: readonly string[];
  readonly document: KnowledgeDocumentViewV1 | null;
  readonly version: KnowledgeVersionViewV1 | null;
  /** The package view with counts refreshed to include this ingest. */
  readonly package: KnowledgePackageViewV1;
}

export function toDocumentView(doc: KnowledgeDocument): KnowledgeDocumentViewV1 {
  return {
    id: doc.id,
    title: doc.title,
    sourceKind: doc.sourceKind,
    currentVersionNumber: doc.currentVersionNumber,
  };
}

export function toVersionView(version: KnowledgeVersion): KnowledgeVersionViewV1 {
  return {
    versionNumber: version.versionNumber,
    byteSize: version.byteSize,
    mimeType: version.mimeType,
    createdAt: version.createdAt,
  };
}
