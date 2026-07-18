# PRODUCT_RUNTIME_STATUS_MATRIX

Phase: `PRODUCT_RUNTIME_CLOSURE_V1` — Supervisor **re-audit of the INTEGRATED runtime** (cycle 1 + 2).
Product base: `12a727a` (prodint HEAD). Method: static (read + grep). No source modified.

### Note on "section-16 acceptance criteria"
As at baseline, there is **no literal document titled "section 16"** in-tree (searched
`docs/**`). This matrix maps the **acceptance criteria as enumerated in the coordinator's
re-audit charter**, cross-referenced to `docs/governance/SYSTEM_INVARIANTS_V1.md` and
the migrations. Stated so the mapping is not mistaken for a recovered artifact.

Status: **PASS** · **IN_PROGRESS** (owner/checkpoint active) · **GAP** (real, open).
Detail in the three sibling audit docs.

---

## Acceptance matrix (current)

| # | Acceptance criterion | Status | Evidence | Δ vs baseline |
|---|---|---|---|---|
| 1 | **0 in-memory business adapters in the formal runtime** | PASS | `pg-application-runtime.ts:306-308,277` (KnowledgePackageBridge + Pg industry/provider + PgKnowledgeContentStore); command runtime same (`geo-command-runtime.ts:255-272`). Grep: no `Mem*/InMemory/new Map` in `createPgApplicationRuntime` body. | was IN_PROGRESS (3) → **PASS (0)** |
| 1b | **Durable knowledge content store wired everywhere it's used** | GAP | Composition uses `PgKnowledgeContentStore` (`:277`); the LIVE knowledge lane `getKnowledgeRuntime()` still defaults to `InMemoryKnowledgeContentStore` (`runtime/knowledge/runtime-context.ts:137,187`) — files/urls ingestion text is process-local. | WARN, REAL residual |
| 2 | **Enterprise-knowledge single source of truth** | PASS | `KnowledgePackageBridge` projects/writes the one `knowledge_package` table, refuses to fabricate provenance (`knowledge-package-bridge.ts:1-37,139-148`). | naming-collision risk CLOSED |
| 3 | **No formal page renders business fixtures** | GAP | 3 agency pages still render fixtures: `batch-tasks` (`:35`), `team` (`:35`), `templates` (`:33`). 14 pages API-wired; rest empty placeholders. `app/**`+`ops/**` = 0 fixture imports. | was IN_PROGRESS (≈27) → **3 left** |
| 4 | **No client-surface leak (UUID/Hash/Provider/Schema/Candidate/Brief/Artifact)** | PASS | Reference-code discipline in the 3 residual fixture pages; API DTOs are `…ViewV1` (leak-free); compliance tests present. | — |
| 5 | **Server-derived tenant on ALL command routes** | PASS | `requireSession` + `denyIfCrossTenant` + `sessionCanAccessClientOrganization` (`geo-command-http.ts:29-64`, `geo-command-runtime.ts:388-400`); tenant from session or DB-loaded artifact on all 27 writes. | was N/A (no command routes) → **PASS** |
| 6 | **Command routes trust no client-supplied org id / role** | PASS | Client-id-trust scan clean; `commands/projects` body org id validated vs session assignments / in-tx; ops body ids are targets under a PLATFORM role check. | — |
| 7 | **audit_event on every business write incl. knowledge** | PASS | `runWriteCommand` ALLOWED (`runtime-context.ts:193`) + `denyIfCrossTenant`/`recordDeniedCommand` DENIED; knowledge create/confirm emit `knowledge_package.created/.confirmed` (`geo-command-runtime.ts:309,328`). | baseline GAP 9b CLOSED |
| 7b | **Legacy knowledge lane writes also audited** | GAP | `knowledge/packages/[id]/{confirm,files,urls}` on `getKnowledgeRuntime()` persist actor on the domain row but emit no `audit_event`; audited path exists only on the command route. | WARN, REAL residual (duplicate surface) |
| 8 | **No auto-approve — human review** | PASS | Explicit `CONFIRMED` only; omission → 422; note required for CHANGES/REJECT; append-only (`opportunities/[id]/reviews/route.ts:85-103,130-143`). | — |
| 9 | **No auto-approve — article approval** | PASS | 3 gates must all PASS else 422 + no write (`article-drafts/[id]/reviews/route.ts:120-135`); DB `ck_article_approval_no_silent_approve` (`0004:338`). | — |
| 10 | **Historical artifacts append-only (triggers + no UPDATE/DELETE)** | PASS | Forbid update+delete triggers on all 7 baseline tables + `provider_article_content` (`0005:143-149`) + `knowledge_content` (`0006:92-98`). No UPDATE/DELETE against any in `src/` (grep). | extended to 0005/0006 tables |
| 11 | **Default channels 0** | PASS | `channel_neutral_content_package.target_channel_ids DEFAULT '{}'` (`0004:402`); untouched by 0005/0006. | — |
| 12 | **No automatic publication** | PASS | `ck_publication_receipt_no_auto_publish` (`0004:487-490`) + route domain guard; distribution requires ≥1 channel + non-blank human actor (`0004:455-458`). | — |
| 13 | **Provider calls 0** | PASS | No provider/network port in commands/continuity/geo-services (grep `fetch/axios/http/openai/anthropic` → none); command runtime header `:8-9`; URL ingest requires pre-fetched bytes. | — |
| 14 | **Agency assignment isolation** | PASS | `sessionCanAccessClientOrganization` restricts AGENCY to `assignedClientOrganizationIds` (`geo-command-runtime.ts:396-398`); read-side `listActiveClientsForAgency`; `tests/agency-client-isolation.test.ts`. | — |
| 15 | **Audit actor integrity (genuine, no forge/omit)** | PASS | `CommandActor` always `{session.userId, session.organizationId}`; `recordAuditEvent` actor never from request input. INFO: body `selectedByActorId`/`publishedByActorId` are provenance fields, not the audit actor. | — |
| 16 | **Session cookie authentication integrity** | IN_PROGRESS | Unsigned base64url cookie, forgeable (`session-cookie.ts:11-18`); caps every "server-derived" verdict given an authentic principal. | unchanged (documented) |
| 17 | **DTO single-source (no redeclared equivalent DTO)** | PASS | `…ViewV1` DTOs in `runtime/api-contracts`; command DTOs in `runtime/commands/geo-dto.ts` are new concepts, not duplicates. | — |

---

## Roll-up

- **PASS (13):** 1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 17. (Criteria 5/14
  capped by the documented unsigned-cookie caveat #16, given an authentic principal.)
- **GAP (real, open) (3):**
  - **1b** — live knowledge lane runtime still uses `InMemoryKnowledgeContentStore`
    (durable store wired only into the composition root).
  - **3** — 3 agency pages (`batch-tasks`, `team`, `templates`) still render fixture
    business data (target 0).
  - **7b** — legacy knowledge lane writes (`confirm`/`files`/`urls`) emit no dedicated
    `audit_event`; ingestion has no audited command equivalent.
- **IN_PROGRESS (1):** 16 (session cookie signing).

**No BLOCKER.** Baseline closures this cycle: in-memory adapters 3→0 (crit 1),
frontend fixtures ≈27→3 (crit 3), command API server-derived + audited (crit 5/6/7),
durable content store in composition (crit 1b partial), knowledge create/confirm audit
gap (crit 7). All three remaining GAPs are WARN-level and bounded.

### Suggested single next action
Wire `getKnowledgeRuntime()` to `PgKnowledgeContentStore` (one line —
`runtime/knowledge/runtime-context.ts:187`, adapter already exists). It closes GAP 1b
and, together with an audited ingestion command, is the highest-integrity remaining
continuity closure.
