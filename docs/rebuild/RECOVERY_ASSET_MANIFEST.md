# RECOVERY_ASSET_MANIFEST

Generated from a read-only scan of `E:\GEO_RECOVERY_SAFE` (no files in that
tree were created, modified, or deleted to produce this manifest). Full
per-file records — `relative_path`, `size`, `sha256`, `file_type`,
`last_modified`, `recovery_category`, `safe_to_publish`,
`suspected_sensitive`, `target_module`, `reconstruction_priority` — are in
[`RECOVERY_FILE_INVENTORY.json`](RECOVERY_FILE_INVENTORY.json).

## Totals

| Metric | Count |
|---|---|
| Total files scanned | 1,567 |
| `GIT_OBJECT` (loose objects in the recovered git object store) | 1,480 |
| `GIT_METADATA` (worktree HEAD/ORIG_HEAD/logs/index/COMMIT_EDITMSG) | 75 |
| `SOURCE` (named, individually-undeleted source files) | 10 |
| `DOCUMENTATION` (forensic recovery reports) | 2 |
| Placeholder audit subdirectories with zero content | 4 (`part1-build-assets`, `part2-file-attribution`, `part3-database`, `part4-report`) |

## Recovery category breakdown and disposition

- **GIT_OBJECT (1,480 files)** — raw zlib-compressed git loose objects.
  Not imported into this repository: they have no filenames or paths
  (paths only exist inside tree objects, and 0/117 recovered commit root
  trees resolve), so importing them as "recovered source" would
  misrepresent recovery confidence. Their existence and the prior
  session's decompression/validation results are preserved as evidence in
  `docs/rebuild/recovered-evidence/`. One object was spot-checked during
  this session's security screen and found to be an env-config template
  (`GEO_ENV_PROFILE=...`, `DATABASE_URL=postgresql://geo_dev:CHANGE_ME@...`)
  — placeholder values only, no real credential, but excluded from import
  because its original filename/path is unknown and importing an
  unattributed blob blind is out of scope for a hash-verified baseline.
- **GIT_METADATA (75 files)** — worktree `HEAD`/`ORIG_HEAD`/`logs/HEAD`
  files contain a real committer name and email address (the account
  owner's own identity) in plaintext reflog entries — redacted here rather
  than reproduced. Per the security boundary (no real emails), none of
  these 75 files are imported. They
  remain valuable as forensic evidence (they contain real historical SHAs
  used to cross-check the two documentation files above) but are not
  pushed to the public GitHub repository.
- **SOURCE (10 files, in `recovered-orphan-source-files/`)** — individually
  undeleted `.tsx`/`.ts` files with confirmed content but **lost original
  path** (PARTIAL_RECOVERED_SOURCE / class B). Manually content-reviewed
  this session:
  - **7 usable**: `shared.tsx` (FoundationPage shell), `route.ts` (DELETE
    invitation-revocation handler), and 4× `page.tsx` + 1 more `page.tsx`
    covering agency org creation, client org+project creation,
    agency↔client assignment, audit log, and agency-created-client pages.
    No secrets, no customer data. Imported into
    `recovered/partial-source/` (not wired into a live `src/` tree, since
    the original path is unknown and guessing one would blur recovery
    with reconstruction).
  - **3 corrupted**: two `route.ts` and one `page.tsx` recovered only as
    whitespace padding — the undelete process reconstructed the filename
    but not the content. Excluded from import; recorded here so the loss
    is explicit rather than silently dropped.
- **DOCUMENTATION (2 files)** — `TODAY_NODE_RECOVERY_MATRIX.md` and
  `TARGET_STATE_MANIFEST.md`, the prior forensic session's own findings.
  Reviewed for secrets (none found beyond the SHAs/messages already
  discussed above) and imported verbatim into
  `docs/rebuild/recovered-evidence/`.

## Not copied wholesale

Per the operating rules for this rebuild, the recovery directory was never
copied wholesale into the git repository. Only the 9 files marked
`SAFE_TO_COMMIT` in `RECOVERY_FILE_INVENTORY.json` (7 partial-source + 2
documentation) are part of the baseline commit.
