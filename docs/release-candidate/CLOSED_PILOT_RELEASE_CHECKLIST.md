# CLOSED_PILOT_RELEASE_CHECKLIST — go/no-go for the closed pilot

- Phase: `AUTOMATED_PG16_RELEASE_GATE_V1` / checkpoint `CLOSED_PILOT_RELEASE_EVIDENCE_V1` (Agent E)
- Branch: `ops/release-evidence-v1` (baseline `c7c2ab4`, docs only)
- Date: 2026-07-19
- Status vocabulary: **PASS** (evidence exists in the tree), **PENDING_REMOTE_CI** (awaits the
  observed GitHub Actions PG16 run — see `POSTGRES16_REMOTE_CI_REPORT.md`), **HUMAN_PENDING**
  (a named human must act; never auto-closed).
- Release decision at baseline: **CLOSED_PILOT_RC_PENDING_PG16**
  (`docs/release-candidate/OVERNIGHT_CLOSED_PILOT_RC_REPORT.md`). Go/no-go requires every
  PENDING_REMOTE_CI item green from an observed run AND every HUMAN_PENDING item explicitly
  closed by its named human. Nothing in this checklist self-closes.

---

## 1. 自动 Gate (Automated)

| # | Item | Status | Evidence |
| --- | --- | --- | --- |
| A1 | Full test suite green (876 passed / 1 gated skip, 87 files; the skip is the flag-gated canary, by design) | PASS | `docs/release-candidate/OVERNIGHT_CLOSED_PILOT_RC_REPORT.md` (Gates); `docs/release-candidate/OVERNIGHT_RC_PROGRESS.md` (Checkpoint 3, final gate batch 1) |
| A2 | Typecheck clean (`npm run typecheck`) | PASS | `docs/release-candidate/OVERNIGHT_CLOSED_PILOT_RC_REPORT.md` (Gates) |
| A3 | Production build (`npm run build:web`, next build --webpack) | PASS | `docs/release-candidate/OVERNIGHT_CLOSED_PILOT_RC_REPORT.md` (Gates) |
| A4 | Security scan clean + repo safety preflight + no secrets in the committed tree | PASS | `docs/release-candidate/OVERNIGHT_CLOSED_PILOT_RC_REPORT.md` (Gates); `docs/release-candidate/ENVIRONMENT_CONFIGURATION_AUDIT.md` (Item 10, PASS) |
| A5 | Migrations 0001–0008 fresh-apply + manifest + constraints + append-only + idempotency + restart read-back — **PG18-labelled local evidence** (6/6; explicitly NOT a PG16 result) | PASS | `docs/release-candidate/OVERNIGHT_CLOSED_PILOT_RC_REPORT.md` (PG18 Equivalent Verify); `docs/pilot/BACKUP_RESTORE_NOTES.md` (PG18_EQUIVALENT = PASS) |
| A6 | CI PG16 gates — canonical PostgreSQL 16 verification of the full gate set (all three jobs) in GitHub Actions | PASS | Observed run 29654550660 (conclusion success, all 3 jobs green); `docs/release-candidate/POSTGRES16_REMOTE_CI_REPORT.md` (results filled from that run) |

## 2. 人工 Gate (Human)

| # | Item | Status | Evidence |
| --- | --- | --- | --- |
| H1 | Article approval semantics: no automatic approval possible (zero `article_approval` rows before the human decision; DB CHECK `ck_article_approval_no_silent_approve`; session-derived human approver) | PASS | `docs/release-candidate/CLOSED_PILOT_OPERATIONS_REPORT.md` (hop 17, invariants); `docs/release-candidate/CLOSED_PILOT_RC_STATUS.md` (invariant 6) |
| H2 | Human review semantics: review is explicit CONFIRMED only, never silent; system actor refused (route 422 + DB CHECK); opaque review reference only on the client surface | PASS | `docs/release-candidate/CLOSED_PILOT_OPERATIONS_REPORT.md` (hops 13, 20); `docs/pilot/PILOT_READINESS_STATUS_MATRIX.md` (G7–G9); `docs/pilot/AUTH_SECURITY_AUDIT.md` |
| H3 | Release sign-off: a named human signs the go decision for the closed pilot | HUMAN_PENDING | To be recorded against this checklist; prerequisite: A6 green + H4 executed |
| H4 | PRESENT FOR HUMAN APPROVAL step: the completed `POSTGRES16_REMOTE_CI_REPORT.md` (observed-run results) and this checklist are presented to the human approver before any pilot go-live | HUMAN_PENDING | Step defined here; blocked behind A6 (report currently all PENDING_REMOTE_CI) |

## 3. 环境 Gate (Environment)

| # | Item | Status | Evidence |
| --- | --- | --- | --- |
| E1 | PG16 CI green: the observed workflow run concludes success with VERIFIED PostgreSQL Version from `SELECT version()` (never the image name) | PASS | Run 29654550660: SELECT version() = PostgreSQL 16.14 (Debian 16.14-1.pgdg13+1); `docs/release-candidate/POSTGRES16_REMOTE_CI_REPORT.md` (Run identity table) |
| E2 | DB role separation: runtime / test / canary roles distinct; canary refuses runtime/test targets; preflight 3/3 PASS with closed 6-code taxonomy | PASS | `docs/pilot/DATABASE_ENVIRONMENT_ROLES.md`; `docs/release-candidate/ENVIRONMENT_CONFIGURATION_AUDIT.md` (Item 3, PASS_WITH_CHANGES — defense-in-depth follow-up only); `docs/release-candidate/OVERNIGHT_CLOSED_PILOT_RC_REPORT.md` (Databases) |
| E3 | Session keys provisioned for the pilot deploy environment (`SESSION_SIGNING_KEY_CURRENT` set; `SESSION_SIGNING_KEY_PREVIOUS` empty at start; `REVIEW_REFERENCE_KEY_CURRENT` decided) — operator action in the target environment; rotation mechanics already proven E2E | HUMAN_PENDING | Mechanics: `docs/release-candidate/CLOSED_PILOT_OPERATIONS_REPORT.md` (drill c); procedure: `docs/pilot/PILOT_OPERATOR_RUNBOOK.md` (§0, §8); names: `docs/release-candidate/DEPLOYMENT_INPUTS_TEMPLATE.md` |
| E4 | Provider flag OFF: `PROVIDER_RUNTIME_ENABLED` resolves false (default-OFF semantics; no committed file enables it; no real call path reachable) | PASS | `docs/release-candidate/OVERNIGHT_CLOSED_PILOT_RC_REPORT.md` (Provider); `docs/release-candidate/ENVIRONMENT_CONFIGURATION_AUDIT.md` (Item 4, PASS); `docs/pilot/PROVIDER_BOUNDARY_AUDIT.md` |

## 4. 试点运营 Gate (Pilot Operations)

| # | Item | Status | Evidence |
| --- | --- | --- | --- |
| P1 | Sanitized accounts only: every pilot identity on a reserved test domain, every org name carries an explicit fixture marker | PASS | `docs/release-candidate/CLOSED_PILOT_OPERATIONS_REPORT.md` (Sanitization); `docs/pilot/PILOT_ACCEPTANCE_REPORT.md` (fixture table) |
| P2 | 0 real customer data: `Real Customer Data Used: 0` asserted in-suite at end of run | PASS | `docs/release-candidate/OVERNIGHT_CLOSED_PILOT_RC_REPORT.md` (E2E and invariants); `docs/release-candidate/CLOSED_PILOT_OPERATIONS_REPORT.md` (invariant table) |
| P3 | Operator runbook read: the pilot operator confirms having read `docs/pilot/PILOT_OPERATOR_RUNBOOK.md` (start / migrate / backup / restore / rollback / provider-off / session-revoke / key-rotation) | HUMAN_PENDING | Runbook exists: `docs/pilot/PILOT_OPERATOR_RUNBOOK.md`; recovery matrix: `docs/pilot/PILOT_FAILURE_RECOVERY_MATRIX.md` |
| P4 | Backup schedule agreed and recorded (cadence, retention, checksum recording, restore-drill interval) — backup/restore capability itself already proven E2E | HUMAN_PENDING | Capability: `docs/pilot/BACKUP_RESTORE_NOTES.md` (backup+restore+survival PASS); `docs/release-candidate/CLOSED_PILOT_OPERATIONS_REPORT.md` (drill d); procedure: `docs/pilot/PILOT_OPERATOR_RUNBOOK.md` (§3–§4) |
| P5 | Incident contact named: an on-call human contact (and escalation path) is recorded for the pilot window | HUMAN_PENDING | To be recorded against this checklist; failure playbooks: `docs/pilot/PILOT_FAILURE_RECOVERY_MATRIX.md`, `docs/release-candidate/CI_FAILURE_RECOVERY_MATRIX.md` |

---

## Tally

| Category | Items | PASS | PENDING_REMOTE_CI | HUMAN_PENDING |
| --- | --- | --- | --- | --- |
| 自动 Gate (Automated) | 6 | 5 | 1 | 0 |
| 人工 Gate (Human) | 4 | 2 | 0 | 2 |
| 环境 Gate (Environment) | 4 | 2 | 1 | 1 |
| 试点运营 Gate (Pilot Operations) | 5 | 2 | 0 | 3 |
| **Total** | **19** | **11** | **2** | **6** |

## Go/no-go rule

**NO-GO** while any item is PENDING_REMOTE_CI or HUMAN_PENDING. The two PENDING_REMOTE_CI items
(A6, E1) close ONLY from an observed GitHub Actions run recorded in
`POSTGRES16_REMOTE_CI_REPORT.md` (NOT_RUN is never recorded as PASS). The six HUMAN_PENDING items
(H3, H4, E3, P3, P4, P5) close ONLY by explicit, attributable human action. PG18-labelled evidence
(A5) never substitutes for A6/E1.
