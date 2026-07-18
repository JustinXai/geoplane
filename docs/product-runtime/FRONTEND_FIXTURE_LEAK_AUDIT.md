# FRONTEND_FIXTURE_LEAK_AUDIT

Phase: `PRODUCT_RUNTIME_CLOSURE_V1` — Supervisor **re-audit of the INTEGRATED runtime** (cycle 1 + 2).
Product base: `12a727a`. Method: static (read + grep). No source modified.

Question: for each formal page under `src/app/{app,agency,ops}`, does it still
**render business fixture data** (VIOLATION), is it **wired to a real API**
(acceptable), or is it a **clean empty placeholder** (acceptable)? Plus the
client-surface leak-vector check (UUID/Hash/Provider/Schema/Candidate/Brief/Artifact).

Severity: **BLOCKER / WARN / INFO**. Disposition: **PASS** · **IN_PROGRESS** · **GAP**.

Classification: **A** = renders fixture business data (violation) · **B** = wired to a
real API · **C** = clean empty placeholder / chrome (acceptable).

---

## 1. Headline

- **Fixture-DISPLAYING formal pages: 3** — all in `/agency`, all surfaces with no
  backing endpoint yet. Baseline was effectively all 27 pages; now down to 3.
- The `app/**` and `ops/**` page directories contain **zero** fixture imports. Every
  one is either wired to a real API (B) or a clean empty placeholder (C).
- **Leak risk: LOW / none observed.** The 3 remaining fixture pages use the same
  reference-code discipline (no UUID/hash/provider/schema/pipeline vocabulary); the
  `_fixtures.ts` modules still exist but are no longer imported by `app`/`ops` pages.

---

## 2. The 3 fixture-DISPLAYING pages (Category A — VIOLATION vs target 0)

| # | Page | Fixture rendered | Import → JSX evidence |
|---|---|---|---|
| 1 | `src/app/agency/batch-tasks/page.tsx` | `BATCH_TASKS` | import `:15` → `BATCH_TASKS.map(...)` `:35` (renders `item.name`/`referenceCode`/`statusLabel` `:37-41`) |
| 2 | `src/app/agency/team/page.tsx` | `AGENCY_TEAM_MEMBERS` | import `:18` → `AGENCY_TEAM_MEMBERS.map(...)` `:35` (renders `displayName`/`roleLabel` `:37-39`) |
| 3 | `src/app/agency/templates/page.tsx` | `INDUSTRY_TEMPLATES` | import `:16` → `INDUSTRY_TEMPLATES.map(...)` `:33` (renders `name`/`industryLabel`/`summary` `:35-39`) |

- **Severity WARN, GAP (REAL) vs the "0 fixture pages" target.** These are
  presentation-only placeholders for surfaces (batch tasks / team & permissions /
  industry templates) that have **no read or command endpoint** in this cycle. They
  render fixture business lists instead of an empty state — the same treatment the ops
  pages already received. Not a security BLOCKER (no real client data, reference codes
  only), but they are the residual gap to close.
- **Smallest fix:** convert each to a clean empty placeholder (Category C) — the exact
  pattern already applied to `ops/executions`, `ops/review-queue`, etc. — until an
  endpoint exists.

**Note — not a violation:** `agency/branding/page.tsx` imports only
`AGENCY_ACTING_CONTEXT` (`:16`), the two-string acting-context **banner label**
(`agency/_fixtures.ts:45-48`), and renders a static placeholder body (`:29`). Banner
label ≠ business data → Category C.

---

## 3. Pages wired to real APIs (Category B — 14)

| Page | Endpoint(s) |
|---|---|
| `app/page.tsx` | GET /api/account, GET /api/projects |
| `app/content/page.tsx` | GET /api/projects/[id]/opportunities |
| `app/delivery/page.tsx` | GET /api/projects/[id]/deliveries |
| `app/keywords/page.tsx` | GET /api/projects/[id]/keyword-questions |
| `app/knowledge/[packageId]/page.tsx` | GET /api/knowledge/packages/[id] (+ /issues) |
| `agency/page.tsx` | GET /api/agency/clients |
| `agency/clients/page.tsx` | GET /api/agency/clients, POST /api/agency/context |
| `agency/projects/page.tsx` | GET /api/projects |
| `agency/deliveries/page.tsx` | GET /api/projects (+ /deliveries) |
| `agency/keyword-questions/page.tsx` | GET /api/projects (+ /keyword-questions) |
| `agency/review-queue/page.tsx` | GET /api/projects (+ /review-queue) |
| `ops/audit/page.tsx` | GET /api/ops/audit |
| `ops/client-assignments/page.tsx` | GET /api/ops/audit (filtered to assignment actions) |
| `ops/invitations/page.tsx` | GET /api/ops/audit (filtered to invitation actions) |
| `ops/organizations/page.tsx` | GET /api/ops/organizations, GET /api/projects |

## 4. Clean empty placeholders (Category C — incl. 3 layouts)

`app/knowledge/page.tsx`, `app/performance/page.tsx`, `ops/page.tsx`,
`ops/evidence-audit`, `ops/executions`, `ops/models-usage`, `ops/publisher-connectors`,
`ops/review-queue`, `ops/rule-packs`, `ops/system-health`, `agency/branding`, plus the
`app`/`agency`/`ops` `layout.tsx` chrome. Each renders headers + an empty-state string
(e.g. "暂无…数据"); most carry a comment noting the fixture list was removed.

---

## 5. Client-surface leak-vector assessment (the 3 fixture pages + fixture modules)

| Vector | Status | Evidence |
|---|---|---|
| **UUID / DB key** | No leak. Reference codes only (`BTH-0031`, `USR-0101`, `TPL-0004`, `CLI-0002`…). | `agency/_fixtures.ts:20-21` (rule) + rendered values |
| **Hash** | No leak. No hash in any rendered fixture string. | grep `hash` in agency fixtures → none |
| **Provider / vendor name** | No leak. No vendor names in agency fixtures (models surface is ops-only, now unrendered). | `ops/_fixtures.ts:360-394` no longer imported by any page |
| **Schema / version internals** | No leak. No `…V1Schema` / `schema_version` in rendered strings. | agency fixtures |
| **Candidate / Brief / Artifact / Compiler vocab** | No leak. Rendered labels are plain business terms (批量任务 / 团队 / 行业模板). | pages 1-3 JSX |
| **Publication defaults** | Held. `AGENCY_DELIVERY_PACKAGES.autoPublishedCount:0` / `PUBLISHER_CONNECTORS.enabled:false` remain, but those fixtures are no longer rendered (delivery is now API-wired). | `agency/_fixtures.ts:234-260` |

Compliance tests `tests/client-workspace-copy.test.ts` and `tests/ops-workspace-copy.test.ts`
remain present (not re-run here).

---

## 6. Summary

| Finding | Severity | Disposition |
|---|---|---|
| 3 agency pages still render fixture business data | WARN | GAP (REAL) vs target 0 — batch-tasks, team, templates |
| 14 pages wired to real APIs | — | PASS (was IN_PROGRESS at baseline) |
| `app/**` + `ops/**` pages: 0 fixture imports | — | PASS |
| No client-surface leak (UUID/Hash/Provider/Schema/pipeline) | — | PASS |
| `agency/branding` imports only the banner label | INFO | not a violation (Category C) |

**Fixture-DISPLAYING formal page count: 3** — `agency/batch-tasks`, `agency/team`,
`agency/templates`. No BLOCKER; no client-surface leak.
