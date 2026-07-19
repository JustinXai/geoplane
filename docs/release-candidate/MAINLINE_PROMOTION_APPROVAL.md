# MAINLINE_PROMOTION_APPROVAL — closed pilot RC → main

- Date: 2026-07-19
- Approver: Clara Webster, GEO Control Plane 项目最终决策负责人 (final decision owner)
- Basis reviewed by approver: `CLOSED_PILOT_RELEASE_CHECKLIST.md`, `POSTGRES16_REMOTE_CI_REPORT.md`
  (observed GitHub Actions run 29654550660, PostgreSQL 16.14, all three jobs green), and the
  current Release Candidate verification results (`OVERNIGHT_CLOSED_PILOT_RC_REPORT.md`).

## Decision

CLOSED_PILOT_READY_FOR_HUMAN_APPROVAL → **GO FOR MAINLINE PROMOTION**

## Scope authorized

1. Merge `integration/closed-pilot-rc-ci-v1` into `main`.
2. Create a frozen release tag on the resulting `main` commit.
3. Prepare deployment handoff materials.

## Scope explicitly NOT authorized

1. Automated deployment.
2. Opening the system to real customers.
3. Any further real-provider calls.
4. Any auto-approve step.
5. Any auto-publish step.

## Checklist items closed by this approval

| Item | Status | Note |
| --- | --- | --- |
| H3 — Release sign-off | **APPROVED** | This document is the sign-off record |
| H4 — Present-for-approval step | **APPROVED** | Checklist + PG16 CI report were presented and reviewed prior to this decision |

## Checklist items intentionally left open (deployment-time, not merge-time)

These remain `HUMAN_PENDING` (per this approval, tracked as **DEPLOYMENT_PENDING** — same
meaning: must be closed by a named human before pilot go-live, never auto-closed) and are out of
scope for this approval:

| Item | What remains | Where the procedure/inputs already live |
| --- | --- | --- |
| E3 | Provision session/review signing keys in the target deploy environment | `docs/pilot/PILOT_OPERATOR_RUNBOOK.md` (§0, §8); variable names in `docs/release-candidate/DEPLOYMENT_INPUTS_TEMPLATE.md` |
| P3 | Operator confirms having read the runbook | `docs/pilot/PILOT_OPERATOR_RUNBOOK.md` |
| P4 | Agree and record backup cadence/retention/verification schedule | `docs/pilot/BACKUP_RESTORE_NOTES.md`; procedure in runbook §3–§4 |
| P5 | Name the on-call/incident contact for the pilot window | `docs/pilot/PILOT_FAILURE_RECOVERY_MATRIX.md`, `docs/release-candidate/CI_FAILURE_RECOVERY_MATRIX.md` |

## Post-approval technical actions (this record)

- Merged `integration/closed-pilot-rc-ci-v1` (`69c1c97`) into `main` — fast-forward, no conflicts.
- Tagged the resulting commit `closed-pilot-rc-ci-v1-2026-07-19`.
- `PROVIDER_RUNTIME_ENABLED` remains default-OFF; no committed file enables it (unaffected by this
  promotion).

## Explicitly out of scope until E3/P3/P4/P5 close

No deployment, environment provisioning, or provider-enablement action should be taken on the
strength of this approval alone. This record authorizes only the three items listed under
"Scope authorized" above.
