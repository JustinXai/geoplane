# DATA_CONTINUITY_AUDIT

Phase: `PRODUCT_RUNTIME_CLOSURE_V1` — Supervisor baseline (read-only static audit).
Product base: `21e36aa` (branch `audit/product-runtime-supervisor-v1`).
Method: static — read + grep. No code was modified. Where a claim could not be
established statically it is marked so explicitly.

Severity legend: **BLOCKER** (breaks a frozen invariant now) · **WARN** (real gap,
scoped/tolerated) · **INFO** (observation, no action implied).
Disposition: **REAL** violation vs **KNOWN-IN-PROGRESS** (a lane is actively
replacing it this phase).

---

## 1. In-memory business adapter inventory

There are **three** distinct composition graphs in the tree. Only one of them
(the per-lane runtimes) actually serves live HTTP; the two `src/composition/*`
roots are E2E/offline harnesses (see §1.4, evidenced by their sole importers).

### 1.1 `src/composition/pg-application-runtime.ts` — 3 in-memory business adapters

The Postgres product runtime wires 15 real Pg GEO adapters + real tenancy/knowledge
Pg repos, but still substitutes **3 append-only in-memory adapters** for the
deliberately-unpersisted opaque-UUID GEO aggregates:

| # | Adapter | Aggregate | Evidence | Disposition |
|---|---|---|---|---|
| 1 | `MemKnowledgePackageRepository` | geo-business `KnowledgePackage` | `pg-application-runtime.ts:186`, wired at `:330` | KNOWN-IN-PROGRESS |
| 2 | `MemIndustryProfileRepository` | `IndustryProfile` | `pg-application-runtime.ts:208`, wired at `:331` | KNOWN-IN-PROGRESS |
| 3 | `MemProviderArticleContentRepository` | `ProviderArticleContent` | `pg-application-runtime.ts:218`, wired at `:332` | KNOWN-IN-PROGRESS |

These are exactly the three aggregates the task flags as being replaced by
migration 0005 + Agent B. **Confirmed in-progress, not stale:** the module header
(`pg-application-runtime.ts:26-37`) documents them as intentionally out of scope
for persistence today ("distinct from D-lane 0002's knowledge_package … there is
therefore no Pg adapter to substitute for them"), and migration `0005` **does not
yet exist** in this base — `migrations/` holds only `0001`–`0004`. So the
replacement work has not landed on the product base yet; these three are the open
items. Severity **WARN**, KNOWN-IN-PROGRESS.

Additionally this root uses `InMemoryKnowledgeContentStore` (`:317`) — see §2.1.

### 1.2 `src/composition/application-composition-root.ts` — 2 in-memory adapters (offline by design)

| # | Adapter | Evidence | Disposition |
|---|---|---|---|
| 4 | `InMemoryTenancyRepository` | `application-composition-root.ts:24,55` | INFO — offline harness |
| 5 | `InMemoryGeoBusinessRepository` | `application-composition-root.ts:25,56` | INFO — offline harness |

This root is **entirely** Map-backed and is explicitly the OFFLINE root: its own
header (`:18-22`) states "This is still an OFFLINE composition root … no real
database." It is not the product HTTP path (§1.4). Not a product-runtime violation;
listed for completeness.

### 1.3 Live HTTP request path — Postgres only (1 in-memory adapter)

The live Next.js app does **not** use either `src/composition` root. Each lane
route builds its own Pg-backed runtime:

- `getAuthRuntime()` → `createAuthRuntime` → `createRepositories(db)` — all Pg
  (`src/runtime/auth/runtime-context.ts:276-287, 177-181`).
- `getKnowledgeRuntime()` → Pg knowledge repos + `InMemoryKnowledgeContentStore`
  (`src/runtime/knowledge/runtime-context.ts:129-143`).
- `getGeoRuntime()` → Pg GEO read repos + Pg tenancy repos
  (`src/runtime/geo/runtime-context.ts:117-119`).

The **only** in-memory adapter in the live request path is
`InMemoryKnowledgeContentStore` (raw knowledge source text — §2.1).

### 1.4 Consumers (proof the composition roots are harnesses)

- `createPgApplicationRuntime` imported only by `tests/e2e/core-runtime-e2e.pg.test.ts`.
- `createApplicationCompositionRoot` / `ApplicationCompositionRootV1` imported only by
  `tests/composition/application-composition-root.test.ts`,
  `tests/e2e/minimal-runtime-e2e.test.ts` (and internal composition files).
- No `src/app/**` route imports either root.

**Headline count (product Postgres runtime):** **3** in-memory business-aggregate
adapters (KnowledgePackage / IndustryProfile / ProviderArticleContent), all
KNOWN-IN-PROGRESS. The offline root adds 2 more (test-only). Live HTTP path: 1
in-memory content store only.

---

## 2. Persistence gaps

### 2.1 Raw knowledge source text is process-local (WARN, REAL-but-documented)

`InMemoryKnowledgeContentStore` (`src/runtime/knowledge/ingestion/content-store.ts:28-46`)
is a `Map<string,string>`. It backs the **live** knowledge runtime
(`runtime-context.ts:137`) as well as the pg E2E root (`pg-application-runtime.ts:317`).
The append-only `knowledge_version` row persists `storage_path` + `content_hash`
(durable metadata) but the extracted text itself lives behind this content-store
seam (`content-store.ts` header; `migrations/0002_knowledge_runtime.sql:111-137`).

- **Impact:** extracted knowledge text does **not** survive a process restart in
  the live runtime; only the version metadata (path/hash) is durable.
- **Disposition:** the header documents this as an intentional seam ("production
  would be object storage / disk; tests use the in-memory impl"). No Pg/disk
  content store exists yet (grep `ContentStore` → only the in-memory impl + wiring).
  **WARN, REAL gap, documented** — a durable content store is unlanded.

### 2.2 Three GEO aggregates unpersisted (WARN, KNOWN-IN-PROGRESS)

As §1.1: `KnowledgePackage` / `IndustryProfile` / `ProviderArticleContent` have no
backing table (migration `0003_geo_runtime.sql` header, "Non-FK id references").
Data written to them is lost on restart. Being replaced by 0005 + Agent B.

### 2.3 No UPDATE/DELETE leakage on append-only tables (INFO — good)

Grep for `UPDATE|DELETE FROM` against the seven append-only tables in `src/` →
**zero** matches. Mutable-table repos (`knowledge_package`, `session`,
`invitation`, `agency_client_assignment`, `enterprise_profile`) do contain
UPDATEs, confirming the negative result is real, not a broken query. See
API/immutability findings in `PRODUCT_RUNTIME_STATUS_MATRIX.md`.

---

## 3. Single source of truth — enterprise knowledge

**Status: OK (durable path exists).** The client-facing, durable enterprise
knowledge record is the **D-lane `KnowledgePackage` / `EnterpriseProfile`**,
persisted through the real Pg knowledge repositories (migration
`0002_knowledge_runtime.sql`): `PgKnowledgePackageRepository`,
`PgKnowledgeDocumentRepository`, `PgKnowledgeVersionRepository`,
`PgEnterpriseProfileRepository` (`pg-application-runtime.ts:100-103, 313-316`;
live at `runtime-context.ts:99-107`).

The geo-business `KnowledgePackage` aggregate (the in-memory one, §1.1) is a
**distinct** thing referenced only by opaque UUID from the persisted GEO tables
(`pg-application-runtime.ts:26-37`). So there is no split-brain over the *durable*
enterprise knowledge: it has a single Postgres home. The naming collision between
the two `KnowledgePackage` concepts is a documentation/clarity risk (**INFO**),
not a data-continuity split — but it is worth watching as 0005 lands, so the geo
aggregate does not silently become a second source of truth for the same facts.

---

## 4. Summary

| Finding | Severity | REAL / IN-PROGRESS |
|---|---|---|
| 3 in-memory GEO aggregate adapters in pg product runtime | WARN | KNOWN-IN-PROGRESS (0005 + Agent B; 0005 unlanded) |
| Raw knowledge text stored in-memory (live runtime) | WARN | REAL, documented seam |
| Offline composition root fully in-memory | INFO | by-design test harness |
| Enterprise-knowledge durable single source (Pg) | — | PASS |
| No UPDATE/DELETE against append-only tables | — | PASS |
| Two distinct `KnowledgePackage` concepts share a name | INFO | watch as 0005 lands |

**In-memory business adapter count (product Postgres runtime): 3.** (Offline
test root: +2. Live HTTP path: 1 content store only.)
