# RUNTIME_DATA_CONTINUITY_V1 — canonical storage map

Checkpoint: **RUNTIME_DATA_CONTINUITY_V1** (Agent B, branch `runtime/data-continuity-v1`).

Purpose: replace the three append-only **in-memory** GEO adapters the composition
root used (`src/composition/pg-application-runtime.ts`, "Deliberately-transient
aggregates") with real Postgres persistence — establishing a **single source of
truth** per aggregate, so nothing generated is lost on a restart and there is no
duplicate copy of enterprise knowledge. Formal in-memory business adapters -> 0.

| Geo port (`src/runtime/geo/ports.ts`) | Canonical storage | Adapter (`src/persistence/runtime-continuity/`) | Single-source-of-truth rationale |
| --- | --- | --- | --- |
| `KnowledgePackageRepository` | **Existing** `knowledge_package` table (migration **0002**, owned by the knowledge runtime) — **no new table** | `knowledge-package-bridge.ts` (`KnowledgePackageBridge`) | Enterprise knowledge already has a durable, ingestion-managed home in 0002. Creating a second geo-owned `knowledge_package` table would fork the truth and let the two copies drift. The bridge instead **projects** the one canonical row into the geo-business `KnowledgePackage` shape, so reads through the geo port and reads through the knowledge runtime are guaranteed to be the same data. |
| `IndustryProfileRepository` | **New** `industry_profile` table (migration **0005**) | `industry-profile-repository.ts` (`PgIndustryProfileRepository`) | The geo-business IndustryProfile had **no** existing home (0003 referenced it only by an opaque, non-FK `industry_profile_id`). 0005 gives it one canonical row **per project** (`UNIQUE(client_organization_id, project_id)`), FK-scoped to `organization`/`project`, so a project's industry classification is unambiguous and durable. |
| `ProviderArticleContentRepository` | **New** `provider_article_content` table (migration **0005**) | `provider-article-content-repository.ts` (`PgProviderArticleContentRepository`) | The geo-business ProviderArticleContent had **no** existing home. 0005 gives it an **append-only, versioned** table so the *deterministic offline-provider output* survives a restart and can be re-opened without re-generating it. Rows store only an **opaque** `provider_response_envelope_id`, never raw payload — persisting them is data movement, not a provider call (**Provider Calls = 0**). |

## KnowledgePackage bridge: field mapping (0002 row -> geo-business contract)

The 0002 `knowledge_package` schema does not carry every geo-business field, so
two fields are **derived projections** (documented here so the projection is not
mistaken for stored data):

| geo-business `KnowledgePackage` field | Source in `knowledge_package` (0002) |
| --- | --- |
| `id`, `clientOrganizationId`, `projectId`, `title`, `createdAt` | direct columns |
| `status` | `CONFIRMED` -> `"SEALED"` (immutable history); `DRAFT` / `IN_REVIEW` -> `"DRAFT"` |
| `sealedAt` (SEALED variant only) | `confirmed_at` |
| `version` | **derived**: `ROW_NUMBER()` over `(client_organization_id, project_id)` ordered by `(created_at, id)` — deterministic, monotonic-per-scope, matching the contract's "monotonically increasing per (clientOrganizationId, projectId)" |
| `sourceDescription` | **derived**: a stable human-readable string over the row's `classification` |

**Write path (`add`).** Enterprise knowledge is normally created through the
knowledge runtime, which carries the per-user provenance
(`knowledge_package.created_by_user_id`) the geo-business shape does not. To keep
the single source of truth, `KnowledgePackageBridge.add` writes into the **same**
`knowledge_package` table, but only when the bridge is wired with a
service-principal `createdByUserId` (`KnowledgePackageBridgeOptions`); otherwise
it throws rather than fabricating a provenance identity. A geo-supplied `version`
/ `sourceDescription` are not stored (the canonical schema has no column for
them) — they are re-derived on read, per the table above.

## Append-only / mutation posture

- `provider_article_content` — **append-only**: a re-generation is a new
  versioned row. `UPDATE`/`DELETE` are forbidden by DB triggers
  (`trg_provider_article_content_forbid_*`), same pattern as 0003's
  `opportunity_validation`. `add` rejects a duplicate id (23505 -> append-only).
- `industry_profile` — **canonical singleton per project**, re-classified in
  place via `PgIndustryProfileRepository.upsert` (bumps `updated_at`, keeps the
  id). `add` is insert-only and rejects a duplicate id **and** a second profile
  for the same project.
- `KnowledgePackageBridge` — read projection over 0002; `add` rejects a duplicate
  id (append-only over `knowledge_package`).

## Restart continuity

Data written through one `createPgDatabase` pool is readable through a **new**
pool after the first is closed (proven at the persistence level in
`tests/runtime-continuity/`), because all three adapters persist to Postgres —
nothing lives only in process memory anymore.
