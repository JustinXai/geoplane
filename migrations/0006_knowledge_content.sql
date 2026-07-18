-- ============================================================================
-- Migration: 0006_knowledge_content
-- Checkpoint: RUNTIME_DATA_CONTINUITY_V1 batch 2 — DURABLE_KNOWLEDGE_CONTENT_STORE
--             (Agent B2 / runtime/data-continuity-v1)
--
-- Gap fixed (supervisor DATA_CONTINUITY_AUDIT GAP #1): the composition root
--   (src/composition/pg-application-runtime.ts) wires the knowledge ingestion
--   service with `new InMemoryKnowledgeContentStore()`. Migration 0002's
--   knowledge_version row stores only a storage_path + content_hash — the
--   EXTRACTED TEXT lives ONLY in that process-local Map and is LOST on restart.
--   This table gives that extracted text a durable, content-addressed home so an
--   uploaded enterprise document's text survives an application restart.
--
-- Content-addressed & append-only (docs/governance/SYSTEM_INVARIANTS_V1.md,
--   "historical artifacts are never mutated"): the storage_path the ingestion
--   service computes is the content-address key — `knowledge/{package}/{document}/
--   {content_hash}` (see src/runtime/knowledge/ingestion/ingestion-service.ts).
--   Because the last path segment is the sha256 of the bytes, a given key is
--   IMMUTABLE: re-putting the same key with identical bytes is a no-op, and a put
--   of DIFFERENT bytes under the same key is rejected by the adapter. UPDATE and
--   DELETE are forbidden at the database level by triggers (same pattern as
--   0002's knowledge_version and 0005's provider_article_content), so recorded
--   knowledge text can never be silently overwritten — not even by a compromised
--   app credential. TRUNCATE (used by the test harness) bypasses row triggers by
--   design.
--
-- Tenancy: the table is tenant-scoped (client_organization_id + project_id, real
--   FKs to 0001's organization / project) so stored content is attributable and
--   scopable per tenant. The columns are NULLABLE and set together (both or
--   neither): the KnowledgeContentStore interface the ingestion service calls is
--   `put(storagePath, text)` with no tenant argument, and the composition wires
--   ONE pool-bound store across all tenants — so an unscoped put records NULL
--   tenant while a tenant-scoped adapter instance records the real ids. When a
--   tenant id IS present it is FK-enforced against a real organization/project.
--   This migration foreign-keys out to ONLY 0001's organization(id) and
--   project(id); it does not alter any 0001-0005 object. The content-address key
--   (packageId / documentId inside storage_path) references out-of-scope 0002
--   aggregates polymorphically as plain text, NOT by FK.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- knowledge_content
-- Durable, content-addressed store of a knowledge version's EXTRACTED TEXT. The
-- primary key IS the content-address storage_path the ingestion service computes
-- (see KnowledgeContentStore.put), so the same content lands under the same key
-- exactly once. This is the persistent backing that replaces the in-memory
-- InMemoryKnowledgeContentStore, letting extracted text survive a restart.
-- ----------------------------------------------------------------------------
CREATE TABLE knowledge_content (
  -- The content-address key computed by the ingestion service:
  -- `knowledge/{package_id}/{document_id}/{content_hash}`. Opaque here — treated
  -- as a single immutable string key, never parsed by the schema.
  storage_path             TEXT PRIMARY KEY,
  -- sha256(content_text). Lets the adapter verify an idempotent re-put and reject
  -- a same-key put of different bytes without re-reading the stored text.
  content_hash             TEXT NOT NULL,
  -- The extracted document text itself — the thing that was being lost on
  -- restart. May be empty (an empty extraction is still a valid content object).
  content_text             TEXT NOT NULL,
  -- Tenant scope (nullable; both-or-neither). FK-enforced to 0001 when present.
  client_organization_id   UUID NULL REFERENCES organization(id),
  project_id               UUID NULL REFERENCES project(id),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT ck_knowledge_content_storage_path_not_blank
    CHECK (length(trim(storage_path)) > 0),
  CONSTRAINT ck_knowledge_content_content_hash_not_blank
    CHECK (length(trim(content_hash)) > 0),
  -- Tenant scope is coherent: a row is either fully tenant-scoped or fully
  -- unscoped, never half-attributed.
  CONSTRAINT ck_knowledge_content_tenant_coherent
    CHECK ((client_organization_id IS NULL) = (project_id IS NULL))
);

CREATE INDEX ix_knowledge_content_content_hash ON knowledge_content(content_hash);
CREATE INDEX ix_knowledge_content_client_org ON knowledge_content(client_organization_id);
CREATE INDEX ix_knowledge_content_project ON knowledge_content(project_id);

-- Append-only / immutable content-address: stored knowledge text is history and
-- may never be edited in place or deleted. A content-address is by definition
-- immutable — the only correct way to "change" content is a new key. Same
-- DB-level guarantee as 0002's knowledge_version (UPDATE) and 0005's
-- provider_article_content (UPDATE + DELETE).
CREATE OR REPLACE FUNCTION knowledge_content_forbid_mutation() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'knowledge_content is append-only and content-addressed: % is not permitted (a content-address key is immutable)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_knowledge_content_forbid_update
  BEFORE UPDATE ON knowledge_content
  FOR EACH ROW EXECUTE FUNCTION knowledge_content_forbid_mutation();

CREATE TRIGGER trg_knowledge_content_forbid_delete
  BEFORE DELETE ON knowledge_content
  FOR EACH ROW EXECUTE FUNCTION knowledge_content_forbid_mutation();

COMMIT;
