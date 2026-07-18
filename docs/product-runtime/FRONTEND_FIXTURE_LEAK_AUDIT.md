# FRONTEND_FIXTURE_LEAK_AUDIT

Phase: `PRODUCT_RUNTIME_CLOSURE_V1` — Supervisor baseline (read-only static audit).
Product base: `21e36aa`. Method: static (read + grep). No code modified.

Question: do the formal pages under `src/app/{app,agency,ops}` still import/use
business fixtures (`_fixtures.ts`) for real data, and do those fixtures risk
leaking client-surface internals (UUID / Hash / Provider / Schema / Candidate /
Brief / Artifact)?

Severity: **BLOCKER / WARN / INFO**. Disposition: **REAL** vs **KNOWN-IN-PROGRESS**.

---

## 1. Headline

- **Every** formal page under `src/app/{app,agency,ops}` is **100% fixture-backed.**
  There is **no** real-data wiring in any page: grep for `api-client`/`apiClient`/
  `fetch(` across `src/app/**` and `src/components/**` returns **only**
  `src/components/runtime/AsyncBoundary.tsx` + `async-state.ts` — generic runtime
  helpers that **no page imports**. The typed client (`src/lib/api-client/*`) and
  the real API routes exist, but the pages are not connected to them.
- **Leak risk: LOW.** Fixtures are engineered to never surface internals, and two
  compliance tests assert it (`tests/client-workspace-copy.test.ts`,
  `tests/ops-workspace-copy.test.ts`).
- **Disposition: KNOWN-IN-PROGRESS.** This is the frozen C1–C6 presentation-only
  state (`RUNTIME_COMPOSITION_ROOT.md` §"FrontendReadModelService does not replace
  the frontend's fixtures"; per-page headers say "占位数据 - 无真实客户数据、无数据库连接").
  Wiring pages to the read model is a later checkpoint.

---

## 2. Fixture-backed formal pages (27)

Three fixture modules: `src/app/app/_fixtures.ts`, `src/app/agency/_fixtures.ts`,
`src/app/ops/_fixtures.ts`. Pages importing them:

### Client workspace `/app` (7 pages)
| Page | Fixture symbols | Evidence |
|---|---|---|
| `app/page.tsx` | `ACTIVE_PROJECT` | `:15` |
| `app/knowledge/page.tsx` | `KNOWLEDGE_PACKAGES` | `:16` |
| `app/knowledge/[packageId]/page.tsx` | `KNOWLEDGE_PACKAGES` | `:17` |
| `app/keywords/page.tsx` | `KEYWORD_QUESTION_ITEMS` | `:16` |
| `app/content/page.tsx` | `CONTENT_SOURCING_ITEMS` | `:20` |
| `app/delivery/page.tsx` | `DELIVERY_ITEMS`, `DELIVERY_CHANNEL_NOTICE` | `:20` |
| `app/performance/page.tsx` | (uses fixture module) | fixture ref present |

### Agency workspace `/agency` (8 pages)
| Page | Fixture symbols | Evidence |
|---|---|---|
| `agency/page.tsx` | acting context | fixture ref present |
| `agency/projects/page.tsx` | `AGENCY_ACTING_CONTEXT`, `AGENCY_VISIBLE_CLIENT_PROJECTS` | `:20` |
| `agency/deliveries/page.tsx` | `AGENCY_DELIVERY_PACKAGES`, notice | `:19` |
| `agency/review-queue/page.tsx` | `REVIEW_QUEUE_ITEMS`, notice | `:19` |
| `agency/team/page.tsx` | `AGENCY_TEAM_MEMBERS` | `:18` |
| `agency/templates/page.tsx` | `INDUSTRY_TEMPLATES` | `:16` |
| `agency/batch-tasks/page.tsx` | `BATCH_TASKS`, notice | `:15` |
| `agency/branding/page.tsx` | `AGENCY_ACTING_CONTEXT` | `:16` |

### Ops console `/ops` (12 pages)
| Page | Fixture symbols | Evidence |
|---|---|---|
| `ops/page.tsx` | (uses fixture module) | fixture ref present |
| `ops/organizations/page.tsx` | `ORGANIZATIONS` | `:15` |
| `ops/client-assignments/page.tsx` | `PLATFORM_CLIENT_ASSIGNMENTS` | `:19` |
| `ops/invitations/page.tsx` | `INVITATIONS` | `:18` |
| `ops/audit/page.tsx` | `AUDIT_EVENTS`, `actorDisplay` | `:29` |
| `ops/evidence-audit/page.tsx` | `EVIDENCE_AUDIT_EVENTS` | `:14` |
| `ops/executions/page.tsx` | `EXECUTION_RECORDS` | `:17` |
| `ops/review-queue/page.tsx` | `PLATFORM_REVIEW_QUEUE_ITEMS`, notice | `:20` |
| `ops/models-usage/page.tsx` | `MODEL_USAGE_SUMMARIES`, notice | `:17` |
| `ops/rule-packs/page.tsx` | `RULE_PACKS` | `:15` |
| `ops/publisher-connectors/page.tsx` | `PUBLISHER_CONNECTORS`, notice | `:23` |
| `ops/system-health/page.tsx` | `SYSTEM_HEALTH_COMPONENTS` | `:12` |

Shared components `src/components/agency/agency-acting-banner.tsx` and the three
`workspace-nav/*` also reference fixtures (banner label / nav copy).

**Fixture-backed formal page count: 27.**

---

## 3. Client-surface leak-vector assessment

| Vector | Status | Evidence |
|---|---|---|
| **UUID / DB primary key** | **No leak on client/agency surface.** All ids are human reference codes (`KB-0142`, `KW-0007`, `PRJ-0007`, `DLV-0011`, `CLI-0002`, `TPL-0004`, `ORG-0001`, `RVW-0021`, `INV-0101`…). | `app/_fixtures.ts:12-28` (rule), values throughout; `agency/_fixtures.ts:20-21`; `ops/_fixtures.ts:30-36` |
| **UUID (ops only)** | **INFO.** `ops/_fixtures.ts` `AUDIT_EVENTS[].actorUserId` holds UUID-shaped values (`ops/_fixtures.ts:245-266`) to mirror recovered evidence, but is **truncated to 8 chars** via `actorDisplay()` (`:271-273`) before render and the full value is **never** collected into a display-string list (`collectOpsVisibleStrings` `:510-512` uses `actorDisplay(event)`). Ops is a PLATFORM-only surface. Low risk; watch that no page renders `event.actorUserId` raw — `ops/audit/page.tsx:29` imports `actorDisplay`, consistent with the truncation contract. |
| **Hash** | No leak. No content/artifact hash appears in any fixture display string. | grep: no `hash`/`Hash` in `src/app/**/_fixtures.ts` |
| **Provider / vendor name** | No leak. Model identities genericized to `模型 A/B/C` with codes `MDL-A…`; explicit rule + targeted test collector. | `ops/_fixtures.ts:360-394`, `collectModelUsageVisibleStrings :546-552` |
| **Schema / version internals** | No leak on client surface. No `…V1Schema` / `schema_version` in fixture display strings. | `app/_fixtures.ts:19-24` (rule) |
| **Candidate / Brief / Artifact / Compiler vocabulary** | No leak. Fixtures deliberately avoid internal pipeline vocabulary in display strings (explicitly names `ArticleBriefCandidateV1` as the forbidden internal term). | `app/_fixtures.ts:20-24`; asserted by `client-workspace-copy.test.ts` |
| **Publication defaults** | No leak / invariant held. `DELIVERY_ITEMS[].selectedChannelCount` typed literal `0`; `AGENCY_DELIVERY_PACKAGES[].autoPublishedCount` literal `0`; `PUBLISHER_CONNECTORS[].enabled:false, connectedCount:0`. | `app/_fixtures.ts:169-195`; `agency/_fixtures.ts:234-260`; `ops/_fixtures.ts:440-466` |

### Compliance tests (present, not re-run here)
- `tests/client-workspace-copy.test.ts` — asserts `/app` display strings hold to
  the no-UUID / no-provider / no-internal-vocabulary rules.
- `tests/ops-workspace-copy.test.ts` — asserts ops strings, incl. the
  vendor-name check and that only truncated actor prefixes are surfaced.

---

## 4. Findings

| Finding | Severity | Disposition |
|---|---|---|
| All 27 formal pages render fixtures, no real-data wiring | WARN | KNOWN-IN-PROGRESS (C1–C6 presentation-only, read-model wiring pending) |
| Client/agency fixtures use reference codes, no UUID/hash/provider/schema/pipeline leak | INFO | PASS (test-guarded) |
| Ops `AUDIT_EVENTS.actorUserId` holds full UUIDs in source (truncated before render) | INFO | acceptable; keep render on `actorDisplay()` |
| Publication defaults (`0` channels / `0` auto-published / connectors disabled) pinned by type | INFO | PASS |

**No REAL client-surface leak found.** The dominant fact is that the formal pages
are **not yet wired to real data at all** — so today they cannot leak live
business internals; the risk to manage is *at wiring time*, when reference-code
view-models must be replaced by the frozen `…ViewV1` DTOs without importing raw
ids/hashes. **Fixture-backed formal page count: 27.**
