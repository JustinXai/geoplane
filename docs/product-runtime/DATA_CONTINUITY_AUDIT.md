# DATA_CONTINUITY_AUDIT

Phase: `PRODUCT_RUNTIME_CLOSURE_V1` — Supervisor **re-audit of the INTEGRATED runtime** (cycle 1 + 2).
Product base: `12a727a` (prodint HEAD: data-continuity 0005/0006 + full command API + wired workspaces).
Branch: `audit/product-runtime-supervisor-v1`. Method: static (read + grep). No source modified.

Severity: **BLOCKER** (breaks a frozen invariant now) · **WARN** (real gap, scoped) ·
**INFO**. Disposition: **PASS** · **IN_PROGRESS** · **GAP**.

This supersedes the baseline (21e36aa) edition. Baseline items 1 / 2.1 / 2.2 are now closed.

---

## 1. In-memory business adapter inventory — FORMAL runtime now 0

### 1.1 `src/composition/pg-application-runtime.ts` — **0** in-memory business adapters (PASS)

`createPgApplicationRuntime()` (`pg-application-runtime.ts:258-366`) now wires **only**
real Postgres adapters. The three former `Mem*`/`AppendOnly` classes are gone; the
`InMemory`/`Mem` tokens in this file survive only in comments. Replacements:

| Former in-memory adapter | Now | Evidence |
|---|---|---|
| `MemKnowledgePackageRepository` | `KnowledgePackageBridge(db)` — read/write over canonical `knowledge_package` (0002); single source of truth | `pg-application-runtime.ts:306`; `persistence/runtime-continuity/knowledge-package-bridge.ts:133` |
| `MemIndustryProfileRepository` | `PgIndustryProfileRepository(db)` — migration 0005 `industry_profile` | `pg-application-runtime.ts:307` |
| `MemProviderArticleContentRepository` | `PgProviderArticleContentRepository(db)` — migration 0005 `provider_article_content` | `pg-application-runtime.ts:308` |
| `InMemoryKnowledgeContentStore` | `PgKnowledgeContentStore(db)` — migration 0006 `knowledge_content` | `pg-application-runtime.ts:277` |

Audited knowledge creation is now first-class: `knowledge.createPackage` emits a
`knowledge_package.created` audit event (`pg-application-runtime.ts:284-297`).

**Grep confirmation:** `InMemory|Mem[A-Z]|AppendOnlyMem|new Map<` inside the
`createPgApplicationRuntime` body → none (file matches are comments only).

### 1.2 `src/runtime/commands/geo-command-runtime.ts` — **0** in-memory adapters (PASS)

The write-side command runtime composes the identical Pg adapter set bound to a
command transaction's `Queryable`: `KnowledgePackageBridge` (`:255`),
`PgIndustryProfileRepository` (`:256`), `PgProviderArticleContentRepository` (`:257`),
+ the 15 Pg GEO repos (`:258-272`). No in-memory adapter; no provider/network port
(header `:8-9`). `createPgApplicationRuntime` is consumed by the command runtime and
`tests/e2e/core-runtime-e2e.pg.test.ts`.

### 1.3 Offline root `application-composition-root.ts` — still Map-backed (INFO, unchanged)

`InMemoryTenancyRepository` + `InMemoryGeoBusinessRepository`
(`application-composition-root.ts:55-56`) remain — the explicitly OFFLINE test
harness (header `:16-22`), imported only by `tests/composition/*` and
`tests/e2e/minimal-runtime-e2e.test.ts`. Not the product runtime; out of scope for
the section-16 "formal in-memory adapter count."

**Headline — formal in-memory business adapter count: 0.**

---

## 2. Persistence gaps

### 2.1 Live knowledge ingestion still uses an in-memory content store (WARN, GAP — REAL)

The durable `PgKnowledgeContentStore` (0006) is wired into the **composition root**
(§1.1) but **not** into the live knowledge lane runtime the HTTP ingestion routes
use. `getKnowledgeRuntime()` calls `createKnowledgeRuntime(db)` with no `contentStore`
option (`runtime/knowledge/runtime-context.ts:187`), which then defaults to
`new InMemoryKnowledgeContentStore()` (`runtime/knowledge/runtime-context.ts:137`).

Live routes on that runtime — `POST /api/knowledge/packages/[id]/files` and `/urls`
(both `getKnowledgeRuntime()`) — therefore write the extracted knowledge **text** to
a process-local `Map`. The `knowledge_version` row (storage_path + content_hash) is
durable, but the text itself is lost on restart in the live ingestion path.

- **Severity WARN / GAP (REAL).** Not a security/isolation BLOCKER (metadata + hash
  persist; no cross-tenant exposure). It contradicts "durable content store fully
  wired": the swap reached the composition root, not the lane runtime.
- **Smallest fix:** have `getKnowledgeRuntime()` pass
  `{ contentStore: new PgKnowledgeContentStore(db) }` — the adapter already exists
  (`persistence/runtime-continuity/pg-knowledge-content-store.ts`).

### 2.2 No UPDATE/DELETE leakage on any append-only table (PASS)

Grep for `UPDATE|DELETE FROM` against every append-only table — including the new
`provider_article_content` (0005) and `knowledge_content` (0006), plus
`knowledge_version` — in `src/` → **zero** matches. Mutable-table repos
(`knowledge_package`, `industry_profile` upsert, `session`, `invitation`) do carry
UPDATEs, confirming the negative result is real.

---

## 3. Single source of truth — enterprise knowledge (PASS)

`KnowledgePackageBridge` implements the geo `KnowledgePackageRepository` port **over
the existing `knowledge_package` table** and explicitly does not create or read a
second copy (`knowledge-package-bridge.ts:1-37`). Its `add` writes into the same table
and refuses to fabricate provenance without a service-principal user id (`:139-148`);
duplicate ids are rejected as append-only (`:174-181`). Derived fields (`version` via
`ROW_NUMBER`, `sourceDescription`) are projections (`:98-114`, `STORAGE_MAP.md`). The
two former `KnowledgePackage` concepts are now one canonical row — the baseline
naming-collision risk is closed.

Migration 0005 `industry_profile` is a deliberate **per-project upsert** (mutable
current-state, `UNIQUE (client_organization_id, project_id)`, no forbid trigger by
design — 0005 header `:43-50`, `:88`); `provider_article_content` is append-only
(forbid update+delete triggers `0005:143-149`).

---

## 4. Summary

| Finding | Severity | Disposition |
|---|---|---|
| Formal Pg composition root: 0 in-memory business adapters | — | PASS (was IN_PROGRESS) |
| Command runtime: 0 in-memory adapters | — | PASS |
| Durable knowledge content store (0006) wired into composition | — | PASS |
| Live knowledge lane runtime still defaults to in-memory content store | WARN | GAP (REAL) — `runtime-context.ts:137,187` |
| Enterprise-knowledge single source of truth (bridge over knowledge_package) | — | PASS |
| No UPDATE/DELETE against append-only tables (incl 0005/0006) | — | PASS |
| Offline composition root still Map-backed | INFO | by-design test harness |

**Formal in-memory business adapter count: 0.** One REAL residual continuity gap
(live knowledge content store), WARN — not a BLOCKER.
