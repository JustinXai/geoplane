# geoplane — GEO Article Production Control Plane

## Status: DISASTER RECOVERY REBUILD (in progress)

This repository was re-established after the original local git history for
this project was lost and confirmed unrecoverable. This is **not** a
continuation of the old git history — it is a new history built from a
verified, hash-recorded recovery source.

See [`docs/rebuild/REBUILD_MASTER_PLAN.md`](docs/rebuild/REBUILD_MASTER_PLAN.md)
for the full recovery plan, [`docs/rebuild/RECOVERY_ASSET_MANIFEST.md`](docs/rebuild/RECOVERY_ASSET_MANIFEST.md)
for what was recovered, and [`docs/rebuild/RECOVERY_GAP_ANALYSIS.md`](docs/rebuild/RECOVERY_GAP_ANALYSIS.md)
for what is still missing.

## What this project is

A knowledge-driven article production and delivery control plane, serving
multi-tenant organizations (platform operators, agencies, and their clients).
Business core: enterprise knowledge base → keyword/question mapping →
content & source grounding → client delivery, with a post-delivery
performance-validation module. See `docs/architecture/` for the frozen
system design.

## Rules while this repo is public

Until this repository's visibility is switched to Private, only sanitized
material may be pushed: redacted source, tests, migrations, architecture
docs, generic fixtures, and UI with no customer data. Never commit `.env`
files, API keys, database credentials, JWT/session secrets, invitation
tokens, cookies, database dumps/data directories, real customer
attachments/evidence, raw provider responses, real emails/phone numbers, or
build output (`node_modules/`, `.next/`, `dist/`, `coverage/`). See
[`docs/rebuild/SECURITY_IMPORT_REPORT.md`](docs/rebuild/SECURITY_IMPORT_REPORT.md).

## Contributing

See [`AGENTS.md`](AGENTS.md) for the branch/PR model used while multiple
recovery agents work on this codebase in parallel.
