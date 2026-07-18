/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC (net-new runtime-phase file)
 * reconstruction_source: ./entities.ts, migrations/0002_knowledge_runtime.sql,
 *   src/persistence/database-port.ts (Queryable seam - repositories depend on the port,
 *   never on `pg` directly), src/runtime/api-contracts/index.ts (the shape of data a
 *   future knowledge API route needs to assemble the frozen view DTOs).
 * reconstruction_reason: KNOWLEDGE_SCHEMA_AND_PORTS_V1 checkpoint - repository port
 *   interfaces the future knowledge API will depend on. Concrete Postgres implementations
 *   live in ./pg/*-repository.ts.
 * original_file_unavailable: n/a (net-new runtime-phase file)
 */
import type {
  EnterpriseProfile,
  KnowledgeClassification,
  KnowledgeDocument,
  KnowledgeDocumentSourceKind,
  KnowledgeIssue,
  KnowledgeIssueKind,
  KnowledgeIssueSeverity,
  KnowledgePackage,
  KnowledgePackageStatus,
  KnowledgePackageWithCounts,
  KnowledgeSnapshot,
  KnowledgeVersion,
} from "./entities.js";

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface CreateKnowledgePackageInput {
  readonly clientOrganizationId: string;
  readonly projectId: string;
  readonly title: string;
  readonly createdByUserId: string;
  readonly classification?: KnowledgeClassification;
  readonly status?: KnowledgePackageStatus;
}

export interface CreateKnowledgeDocumentInput {
  readonly clientOrganizationId: string;
  readonly projectId: string;
  readonly packageId: string;
  readonly title: string;
  readonly createdByUserId: string;
  readonly sourceKind?: KnowledgeDocumentSourceKind;
}

export interface AddKnowledgeVersionInput {
  readonly documentId: string;
  readonly contentHash: string;
  readonly createdByUserId: string;
  readonly storagePath?: string | null;
  readonly byteSize?: number | null;
  readonly mimeType?: string | null;
}

export interface CreateKnowledgeIssueInput {
  readonly clientOrganizationId: string;
  readonly projectId: string;
  readonly packageId: string;
  readonly kind: KnowledgeIssueKind;
  readonly message: string;
  readonly createdByUserId: string;
  readonly documentId?: string | null;
  readonly severity?: KnowledgeIssueSeverity;
}

export interface CreateKnowledgeSnapshotInput {
  readonly clientOrganizationId: string;
  readonly projectId: string;
  readonly packageId: string;
  readonly contentHash: string;
  readonly documentCount: number;
  readonly createdByUserId: string;
  readonly classification?: KnowledgeClassification;
}

export interface UpsertEnterpriseProfileInput {
  readonly clientOrganizationId: string;
  readonly legalName: string;
  readonly actingUserId: string;
  readonly displayName?: string | null;
  readonly primaryDomain?: string | null;
  readonly industry?: string | null;
  readonly description?: string | null;
  readonly defaultClassification?: KnowledgeClassification;
  readonly forbiddenUsage?: string | null;
}

// ---------------------------------------------------------------------------
// Repository ports
// ---------------------------------------------------------------------------

export interface KnowledgePackageRepository {
  create(input: CreateKnowledgePackageInput): Promise<KnowledgePackage>;
  findById(id: string): Promise<KnowledgePackage | null>;
  /** Tenant-scoped list: only packages belonging to clientOrganizationId. */
  listByProject(
    projectId: string,
    clientOrganizationId: string,
  ): Promise<KnowledgePackage[]>;
  /** The package plus document + open-issue counts a view needs. Tenant-scoped. */
  getWithCounts(
    id: string,
    clientOrganizationId: string,
  ): Promise<KnowledgePackageWithCounts | null>;
  /** Move status DRAFT/IN_REVIEW -> IN_REVIEW/CONFIRMED. */
  setStatus(id: string, status: KnowledgePackageStatus): Promise<KnowledgePackage>;
  /** Confirm the package (status -> CONFIRMED, stamp confirmed_at/by). */
  confirm(id: string, confirmedByUserId: string): Promise<KnowledgePackage>;
}

export interface KnowledgeDocumentRepository {
  create(input: CreateKnowledgeDocumentInput): Promise<KnowledgeDocument>;
  findById(id: string): Promise<KnowledgeDocument | null>;
  listByPackage(packageId: string): Promise<KnowledgeDocument[]>;
}

export interface KnowledgeVersionRepository {
  /**
   * Append the next version for a document (auto-incrementing version_number,
   * bumping the document's current_version_number) atomically.
   */
  addVersion(input: AddKnowledgeVersionInput): Promise<KnowledgeVersion>;
  listByDocument(documentId: string): Promise<KnowledgeVersion[]>;
  getLatest(documentId: string): Promise<KnowledgeVersion | null>;
}

export interface KnowledgeIssueRepository {
  create(input: CreateKnowledgeIssueInput): Promise<KnowledgeIssue>;
  /** @param openOnly when true, returns only unresolved issues. */
  listByPackage(packageId: string, openOnly?: boolean): Promise<KnowledgeIssue[]>;
  resolve(id: string, resolvedByUserId: string): Promise<KnowledgeIssue>;
  countOpen(packageId: string): Promise<number>;
}

export interface KnowledgeSnapshotRepository {
  /**
   * Seal a new snapshot for a package. The prior current snapshot (if any) is
   * marked superseded and snapshot_number is the next in sequence, atomically,
   * preserving the "one current snapshot per package" invariant.
   */
  create(input: CreateKnowledgeSnapshotInput): Promise<KnowledgeSnapshot>;
  /** The single non-superseded snapshot for a package, if one exists. */
  getCurrent(packageId: string): Promise<KnowledgeSnapshot | null>;
  listByPackage(packageId: string): Promise<KnowledgeSnapshot[]>;
}

export interface EnterpriseProfileRepository {
  /** Insert-or-update the single profile for a client organization. */
  upsert(input: UpsertEnterpriseProfileInput): Promise<EnterpriseProfile>;
  findByClientOrganization(
    clientOrganizationId: string,
  ): Promise<EnterpriseProfile | null>;
}
