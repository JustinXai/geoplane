/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC (net-new runtime-phase file)
 * reconstruction_source: migrations/0002_knowledge_runtime.sql (knowledge_version.storage_path
 *   + content_hash - the schema stores a storage REFERENCE and an integrity hash for a
 *   version's content, not the extracted text inline), ../ports.ts (AddKnowledgeVersionInput).
 * reconstruction_reason: KNOWLEDGE_FILE_INGESTION_V1 - the append-only knowledge_version row
 *   carries `storage_path`; the actual extracted text lives behind this content-store seam
 *   (production would be object storage / disk; tests use the in-memory impl). Keeping text
 *   out of the row preserves the 0002 schema unchanged and keeps client-facing shapes free of
 *   raw extracted content.
 * original_file_unavailable: n/a (net-new runtime-phase file)
 */

/**
 * Stores/retrieves a knowledge version's extracted text by its storage path. Content is
 * addressed by the deterministic path the ingestion service computes; a second write of the
 * same path with the same content is a no-op (content-addressed, so idempotent).
 */
export interface KnowledgeContentStore {
  /** Persist `text` at `storagePath`. Returns the storagePath it was stored under. */
  put(storagePath: string, text: string): Promise<string>;
  /** Retrieve previously stored text, or null when nothing is stored at that path. */
  get(storagePath: string): Promise<string | null>;
}

/** Process-local content store for tests and single-process dev runs. */
export class InMemoryKnowledgeContentStore implements KnowledgeContentStore {
  private readonly map = new Map<string, string>();

  async put(storagePath: string, text: string): Promise<string> {
    this.map.set(storagePath, text);
    return storagePath;
  }

  async get(storagePath: string): Promise<string | null> {
    const found = this.map.get(storagePath);
    return found === undefined ? null : found;
  }

  /** Test/inspection helper: how many distinct content objects are stored. */
  get size(): number {
    return this.map.size;
  }
}
