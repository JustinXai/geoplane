# PRODUCT_RUNTIME_STATUS_MATRIX

Phase: `PRODUCT_RUNTIME_CLOSURE_V1` — Supervisor baseline (read-only static audit).
Product base: `21e36aa`. Method: static (read + grep). No code modified.

### Note on "section-15 acceptance criteria"
There is **no literal document titled "section 15"** in this tree (searched
`docs/**`; the acceptance docs use CJK section markers 五/六/七/八 and named
checkpoints). This matrix therefore maps the **PRODUCT_RUNTIME_CLOSURE_V1
acceptance criteria as enumerated in the Supervisor charter** (the nine audited
invariants), cross-referenced to the frozen `docs/governance/SYSTEM_INVARIANTS_V1.md`
and `docs/acceptance/RUNTIME_COMPOSITION_ROOT.md`. Stated so the mapping is not
mistaken for a recovered artifact.

Status: **PASS** · **IN_PROGRESS** (a lane is actively closing it this phase) ·
**GAP** (real, open, no owner identified in-tree). Companion detail in the three
sibling audit docs.

---

## Acceptance matrix

| # | Acceptance criterion | Status | Evidence | Disposition |
|---|---|---|---|---|
| 1 | **No in-memory business adapter in the product runtime** | IN_PROGRESS | `pg-application-runtime.ts:186,208,218` (3 Mem* adapters for KnowledgePackage/IndustryProfile/ProviderArticleContent); migration `0005` absent (only `0001-0004` exist). Live HTTP path is Pg-only except `InMemoryKnowledgeContentStore`. | KNOWN-IN-PROGRESS (0005 + Agent B) |
| 2 | **Durable single source of truth for enterprise knowledge** | PASS | D-lane KnowledgePackage/EnterpriseProfile persisted via Pg knowledge repos (`migrations/0002`; `runtime/knowledge/runtime-context.ts:99-107`). | — |
| 2b | **Raw knowledge source text durably persisted** | GAP | `InMemoryKnowledgeContentStore` backs the live knowledge runtime (`content-store.ts:28-46`; `runtime-context.ts:137`); only `storage_path`+`content_hash` are in Pg. | REAL, documented seam (no durable store landed) |
| 3 | **No business fixtures backing formal pages (real data)** | IN_PROGRESS | All 27 `/app`,`/agency`,`/ops` pages import `_fixtures.ts`; no page uses `api-client`/`fetch`. | KNOWN-IN-PROGRESS (C1–C6 presentation-only) |
| 4 | **No client-surface leak (UUID/Hash/Provider/Schema/Candidate/Brief/Artifact)** | PASS | Reference-code view-models; `client-workspace-copy.test.ts` / `ops-workspace-copy.test.ts`; ops UUID truncated via `actorDisplay` (`ops/_fixtures.ts:271-273`). | — |
| 5 | **Tenant isolation — a CLIENT cannot reach another client's data** | PASS* | `principalCanReadClientOrganization` (`geo/runtime-context.ts:72-81`), `principalOwnsClient` (`knowledge/runtime-context.ts:77-83`), `canAccessClientOrganization` (`auth-service.ts:504`); scope from DB-loaded resource. | *capped by unsigned-cookie caveat (#12) |
| 6 | **Authorization server-derived, never from client-supplied org ids** | PASS | `resolveSession` re-derives role/org/assignments from DB (`auth/runtime-context.ts:191-229` + geo/knowledge equivalents); only `agency/context` reads a body client id, re-validated (`auth-service.ts:419-435`). | — |
| 7 | **Agency assignment isolation — no non-ACTIVE-assigned client exposed** | PASS | `listActiveClientsForAgency` (`auth/runtime-context.ts:118-137`); `setAgencyContext` re-checks assignment; fixture `AGENCY_VISIBLE_CLIENT_PROJECTS` filters ACTIVE (`agency/_fixtures.ts:123-129`); `tests/agency-client-isolation.test.ts`. | — |
| 8 | **Command API does not trust body/param role or org id** | PASS / N/A | Client-id-trust grep over `src/app/api` → only `agency/context` body id (re-validated). Command (write) routes proper are **not yet present** (Agent C). | command routes N/A |
| 9 | **Audit actor genuine & server-derived on business writes** | PASS (partial) | Actor always from session in `persistAuditIntents`/`PgAuditPort` (`auth/runtime-context.ts:231-264`, `pg-application-runtime.ts:131-158`); no forge/omit path. | see #9b |
| 9b | **Audit-event coverage on all business writes** | GAP | Knowledge writes (create/confirm/files/urls) + login/logout persist actor on the domain row but emit **no** `audit_event`. | REAL coverage gap (likely later checkpoint) |
| 10 | **Historical artifact immutability — no UPDATE/DELETE on append-only tables + triggers present** | PASS | Forbid-mutation UPDATE+DELETE triggers on all 7: artifact_index (`0001:422-433`), opportunity_validation (`0003:192-203`), human_review_decision (`0003:282-293`), article_draft (`0004:203-214`), article_approval (`0004:351-362`), publication_receipt (`0004:497-509`), delivery (`0004:539-551`). No UPDATE/DELETE against them in `src/` (grep). | — |
| 11 | **Publication safety** | PASS | Default channels 0: `channel_neutral_content_package.target_channel_ids DEFAULT '{}'` (`0004:402`). Automatic publication rejected: `ck_publication_receipt_no_auto_publish` (`0004:487-490`). Non-empty human-selected distribution: `ck_distribution_plan_channels_nonempty`+actor (`0004:455-458`). Provider calls 0: no network/provider port anywhere (grep `fetch/axios/http/openai/anthropic` in runtime/composition/contracts → none); URL ingest requires pre-fetched bytes (`urls/route.ts:44-52`). | — |
| 12 | **Session cookie authentication integrity** | IN_PROGRESS | Cookie is unsigned base64url JSON, "trivially forgeable" (`session-cookie.ts:20-30`); middleware + resolveSession trust it for `actorUserId`. | KNOWN-IN-PROGRESS (documented; future signed/server-side session) |
| 13 | **DTO single-source (no redeclared equivalent DTO)** | PASS | All `…ViewV1` DTOs in `runtime/api-contracts/index.ts`; every route imports from it. `knowledge/views.ts:70-95` adds 3 **new** (document/version/ingest-result) leak-free DTOs, not duplicates. Fixture view-models are deliberately different reference-code shapes. Prior local enum redeclarations removed in canonical unification (`agency/_fixtures.ts:24-29`, `ops/_fixtures.ts:24-28`). | — |
| 14 | **Role/surface boundary enforced at HTTP layer (not UI-only)** | PASS* | `middleware.ts:37-64` returns 302→/login (unauth) or 403 (cross-surface) for `/app`,`/agency`,`/ops`. | *authorization boundary real; strength capped by #12 |

\* PASS entries marked with an asterisk are correct **given an authentic
principal**; their strength is capped by the documented unsigned-cookie limitation
(#12), which is KNOWN-IN-PROGRESS, not a silent defect.

---

## Roll-up

- **PASS:** 2, 4, 5*, 6, 7, 8, 9, 10, 11, 13, 14* (11 criteria).
- **IN_PROGRESS:** 1 (in-memory GEO aggregates), 3 (frontend fixtures), 12
  (cookie signing) — all with an active owner/checkpoint.
- **GAP (real, open):** 2b (durable content store for raw knowledge text), 9b
  (audit-event coverage for knowledge writes + login/logout).

**No BLOCKER.** The two GAPs are real but bounded and non-destructive: 2b risks
loss of *extracted text* (metadata + hash remain), 9b weakens audit *completeness*
(the actor that is recorded is genuine). Both are candidates for an explicit owner
this phase.

### Suggested single next action
Assign an owner for **GAP 9b** (emit `audit_event` on the knowledge write routes
via the existing `recordAuditEvent` path) — it is the smallest, highest-integrity
closure and reuses machinery already proven in the auth lane.
