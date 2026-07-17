# SECURITY_IMPORT_REPORT

Pre-`git add` security screen run against every file in
`E:\GEO_RECOVERY_SAFE` (1,567 files) before any import into this
repository. Scan covered filename/extension flags
(`.env`, `*.pem`, `*.key`, `*.pfx`, `*.sqlite`, `*.db`, `*.dump`, `*.sql`,
`*.log`) and content pattern matches (`OPENAI_API_KEY`, `DEEPSEEK_API_KEY`,
`DATABASE_URL=`, `POSTGRES_PASSWORD`, `JWT_SECRET`, `SESSION_SECRET`,
`Authorization: Bearer`, `sk-...`, `api_key=`, `password=`, `cookie=`,
`invitation token`, plausible real email addresses, CN phone-number
patterns) across all text-decodable files, including decompressed content
of every recovered git loose object.

## Result

| Outcome | Count |
|---|---|
| Suspected sensitive (flagged, excluded) | 3 |
| Excluded as raw/unattributed recovery artifact (git objects + git metadata) | 1,558 |
| Excluded as corrupted (no usable content) | 3 |
| **SAFE_TO_COMMIT** | **9** |

## The 3 sensitive hits

1. `git-object-database/objects/e1/a6732cf...` — decompresses to an
   env-config template. Contains `DATABASE_URL=postgresql://geo_dev:CHANGE_ME@localhost:55432/...`
   and `GEO_AI_API_KEY=CHANGE_ME`. Manually verified: values are the
   literal placeholder string `CHANGE_ME`, not a real credential. Still
   excluded — no known filename/path, and excluded-by-default is the
   correct call for an unattributed blob regardless of content.
2. & 3. `worktree-metadata/*/logs/HEAD` (×2) — git reflog entries
   containing a real committer name and email address in plaintext (the
   account owner's own identity, redacted here rather than reproduced).
   Excluded per the "no real emails" rule — this rule is not waived just
   because the address is the owner's own.

## SAFE_TO_COMMIT list (the only files imported in the baseline commit)

- `recovered/partial-source/000400000009FE5D3E3C4D93-shared.tsx`
- `recovered/partial-source/00040000000C9C455B787075-route.ts`
- `recovered/partial-source/00040000000C9C5B63B4983F-page.tsx`
- `recovered/partial-source/00040000000C9C5E6C12D671-page.tsx`
- `recovered/partial-source/00040000000C9C607C9A7F12-page.tsx`
- `recovered/partial-source/00040000000C9C6422CCAB4F-page.tsx`
- `recovered/partial-source/00040000000C9C661E8C211C-page.tsx`
- `docs/rebuild/recovered-evidence/TODAY_NODE_RECOVERY_MATRIX.md`
- `docs/rebuild/recovered-evidence/TARGET_STATE_MANIFEST.md`

Everything else in `E:\GEO_RECOVERY_SAFE` — all 1,480 raw git objects, all
75 git worktree metadata files, and the 3 corrupted orphan files — is
excluded from this and all future baseline imports unless a future review
explicitly re-classifies a specific file with a recorded reason.
