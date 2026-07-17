# REBUILD_MASTER_PLAN

Phase: `DISASTER_RECOVERY_REBUILD_V1`
Baseline established: 2026-07-18
Agent role executing this phase: Agent A (Recovery Baseline / Mainline / Integration / Push / Release)

## 1. What happened

The original local git history for this project (working name in forensic
records: `geo-control-plane`) was deleted and is confirmed unrecoverable as
an intact git history. A disk-recovery pass (TestDisk/PhotoRec plus manual
git-object-database forensics) produced a **read-only, byte-verified**
recovery source at `E:\GEO_RECOVERY_SAFE`, consisting of two subtrees:

- `GEO_CONTROL_PLANE_CHECKPOINT/` — a partially-recovered bare git object
  store (`git-object-database/`, 1,480 loose objects), worktree metadata
  from 6 sibling worktrees (`worktree-metadata/`, 75 files: `HEAD`,
  `ORIG_HEAD`, `COMMIT_EDITMSG`, `logs/HEAD`, binary `index`), and 10
  individually undeleted source files with lost original paths
  (`recovered-orphan-source-files/`).
- `GEO_CONTROL_PLANE_REBUILD_AUDIT/` — forensic documentation
  (`TODAY_NODE_RECOVERY_MATRIX.md`, `TARGET_STATE_MANIFEST.md`) plus four
  placeholder audit subdirectories that were never populated with content
  (`part1-build-assets/`, `part2-file-attribution/`, `part3-database/`,
  `part4-report/` — 0 files each, confirmed by directory scan).

**Confirmed lost, not just "not yet found":** both git pack files fail
signature validation; 0 of 117 recovered commit root trees resolve; the
Postgres `data/base/1` and `pg_wal` directories are verified-empty with
matching runtime error logs, i.e. deleted while the database was live, not
merely unindexed by the recovery scan.

**Genuinely unresolved (not proven lost):** `D:\Documents\geo-reference-data`
and its three backup files (`.dump`, `.sql`, `backup-manifest.json`) — path
does not currently exist on disk; the wider forensic scan
(`F:\TestDisk_Recovery`) was still running as of the last recovery session
and has not been re-scanned since. See
[`RECOVERY_GAP_ANALYSIS.md`](RECOVERY_GAP_ANALYSIS.md).

## 2. What this baseline does and does not claim

- Does **not** reuse any historical commit SHA. Every commit in this
  repository's history starts fresh from this baseline.
- Does **not** claim this git history is equivalent to, or a continuation
  of, the lost history.
- Does claim: every file imported in the baseline commit has a recorded
  SHA-256, was read from the read-only recovery source without
  modification, and passed the security import screen in
  [`SECURITY_IMPORT_REPORT.md`](SECURITY_IMPORT_REPORT.md).

## 3. Recovery import classes

Every recovered file lands in exactly one of three classes (see
§VII of the operating instructions this rebuild follows):

- **A. VERIFIED_RECOVERED_SOURCE** — file complete, readable, hash
  recorded, and (for docs) content-reviewed.
- **B. PARTIAL_RECOVERED_SOURCE** — content recovered and verified, but
  missing context (e.g. original file path unknown, references cannot be
  resolved). Placed under `recovered/partial-source/` — deliberately
  **not** wired into a live `src/` tree, because doing so would require
  guessing a path, which is reconstruction, not recovery.
- **C. RECONSTRUCTED_FROM_FROZEN_SPEC** — new implementation written
  against the frozen architecture docs in `docs/architecture/`, because no
  original file was recoverable. Every such file must carry
  `reconstruction_source`, `reconstruction_reason`, and
  `original_file_unavailable` in its PR description. None are included in
  this baseline commit — the baseline contains only classes A and B.

## 4. Sequencing (this session)

1. Read-only inventory + hash of `E:\GEO_RECOVERY_SAFE` →
   `RECOVERY_FILE_INVENTORY.json` / `RECOVERY_ASSET_MANIFEST.md`.
2. Security pre-screen of every file before any `git add` →
   `SECURITY_IMPORT_REPORT.md`.
3. Clone the empty `JustinXai/geoplane` GitHub repo into
   `E:\GEO_REBUILD_WORKSPACE\geoplane`.
4. Write this governance/architecture baseline.
5. Import only files marked `SAFE_TO_COMMIT`.
6. First commit + push + baseline tag.
7. Bundle + parallel branches + worktrees for Agents B/C/D.
8. Report. **Not** in scope for this session: `npm install`, typecheck,
   build, or handing work to Agents B/C/D — those start from the verified
   baseline SHA in a future session.

## 5. Recovery priority order (for Agents B/C/D, once started)

P0 `package.json` / lockfile / `tsconfig` / source root / tests /
migrations / governor / system invariants — **all currently unrecovered**;
see gap analysis. P1 tenancy/auth, organization/membership, project,
invitation, session, audit — **partially recovered**, 7 real source files
in evidence, architecture frozen in
`docs/architecture/MULTI_TENANT_ACCOUNT_MODEL_V1.md`. P2 knowledge
package, keyword/question map, opportunity validation, human review,
family, brief, article compiler, quality gates — architecture frozen in
`docs/architecture/GEO_BUSINESS_CHAIN_V1.md`, strong indirect evidence
(OPR-01B evidence-sealing workflow) that this line was real and in active
use, but no source files recovered. P3 client/agency/ops workspaces. P4
distribution/publisher-bridge/visibility placeholder. UI polish is
explicitly out of order — do not start there.
