# PostgreSQL 16 Staging Environment Attempt

- Checkpoint: POSTGRESQL16_STAGING_VERIFY_V1
- Status: **BLOCKED_PENDING_ENV** (POSTGRESQL16_VERIFY = BLOCKED_PENDING_ENV)
- Date: 2026-07-18
- Branch: `ops/postgres16-staging-v1` (baseline `b31c2cd`)
- Host: Windows 10 Pro 10.0.19045

## Objective

Stand up an isolated PostgreSQL 16 staging instance (Docker preferred, standalone
local PG16 as fallback) and run the full migration / constraint / idempotency /
tenancy / provider-ledger / backup-restore / restart-E2E verification suite
against it. Neither environment option could be established after one honest
end-to-end attempt, so per checkpoint instructions environment work stopped here.

## Attempt log (chronological)

### 1. Docker (preferred path)

| Step | Command | Result |
| --- | --- | --- |
| 1.1 | `docker version` | Client OK: Docker 27.5.1 (windows/amd64, context `desktop-linux`). Server: **engine unreachable** — `error during connect: open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified.` |
| 1.2 | Locate Docker Desktop | `C:\Program Files\Docker\Docker\Docker Desktop.exe` present. |
| 1.3 | Start engine | Launched Docker Desktop via `Start-Process`; polled `docker info --format '{{.ServerVersion}}'` every 5 s for **240 s** — engine never came up. |
| 1.4 | Diagnose backend | `wsl --status` / `wsl -l -v`: **WSL 2 kernel file not found** ("请运行 wsl --update" — run `wsl --update`); no WSL distributions installed. Docker Desktop's `desktop-linux` engine requires the WSL 2 backend on this host. |
| 1.5 | Repair backend | `wsl --update` → exits 255 with **`Catastrophic failure`** while installing "Windows Subsystem for Linux". OS-level blocker; not a Docker or repo issue. |

Blocking error (verbatim):

```
error during connect: Get "http://%2F%2F.%2Fpipe%2FdockerDesktopLinuxEngine/v1.47/version":
open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified.
```

```
wsl --update
正在安装: 适用于 Linux 的 Windows 子系统
Catastrophic failure
(exit code 255)
```

### 2. Standalone local PostgreSQL 16 (fallback path)

| Step | Command | Result |
| --- | --- | --- |
| 2.1 | `Get-ChildItem "C:\Program Files\PostgreSQL"` | Only `18` — no `16` directory. |
| 2.2 | `& "C:\Program Files\PostgreSQL\18\bin\psql.exe" --version` | `psql (PostgreSQL) 18.3` — wrong major version for this checkpoint (16 required). |
| 2.3 | Services | Only `postgresql-x64-18` service exists; no PG16 service. |
| 2.4 | Other locations | Checked `psql`/`pg_ctl`/`initdb` on PATH (absent) and common install roots (`C:\PostgreSQL`, `D:\PostgreSQL`, `E:\PostgreSQL`, `C:\pgsql`, `E:\pgsql`, `C:\tools`) — none exist. |

## Conclusion

- Docker engine cannot start because the WSL 2 kernel is missing and its
  installer fails with `Catastrophic failure` (requires host/OS remediation,
  likely Windows Update / MSI kernel install by an operator).
- No PostgreSQL 16 binaries exist on the host; the only local install is
  PostgreSQL 18.3, which does not satisfy the PG16 verification target.

Per checkpoint rules ("do not keep patching around installation problems"),
no further installation workarounds were attempted (no backend switching, no
ad-hoc binary downloads, no substitution of PG18 for PG16).

## Not performed (pending environment)

All verification items remain **pending**, to be executed once a PG16
environment is available:

- Migrations 0001–0007 (+0008 if `hardening/provider-identity-v1` is ready) via `scripts/db/migrate.mjs`
- Migration manifest verify (`scripts/migration-manifest.mjs`)
- Constraint + append-only trigger verify
- Concurrent idempotency verify
- Tenant isolation (pg-backed tenancy/e2e suites)
- Provider ledger verify (`tests/runtime/provider/provider-ledger.pg.test.ts`)
- Backup (`scripts/backup/backup.mjs`) + restore into fresh DB (`scripts/backup/restore.mjs`)
- Restart E2E data-survival proof

## Unblock checklist for operators

1. Repair WSL 2 (`wsl --update` as admin after Windows servicing repair, or
   install the WSL2 kernel MSI), then start Docker Desktop and confirm
   `docker info` reaches the engine; **or** install standalone PostgreSQL 16.
2. Re-run checkpoint POSTGRESQL16_STAGING_VERIFY_V1 from branch
   `ops/postgres16-staging-v1`.
