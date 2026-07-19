# LOCAL CLOSED-PILOT FAILURE RECOVERY MATRIX

For the same reproducible failure, make at most two fix attempts. After a second failure, stop patching, record reproduction/root cause/impact/dependencies, and enter `ROOT_CAUSE_MODE` with a fresh reviewer. Never obtain a pass by weakening authorization, deleting tests, swallowing errors, changing fixtures to match a defect, or editing database rows.

| Failure | Detection | Safe local recovery | Never do |
| --- | --- | --- | --- |
| Preflight reports missing input | Named presence check fails | Supply the missing value only in gitignored `.env.local`; rerun preflight | Print or commit the value |
| Database purpose mismatch | Preflight names the role and expected database | Correct the affected URL to the exact `geoplane_local_*` database; recheck all three roles | Run a destructive test or seed against runtime to see whether it works |
| Database unreachable/auth rejected | Readiness/preflight returns its closed database error code | Restore local PostgreSQL service/connectivity or rotate the local credential out of band | Change the URL to another project's working database |
| Migration behind | Readiness names missing versions | Back up runtime, then run the repository migration command and require `0001`–`0008` | Edit a shipped migration or mark it applied manually |
| Start fails or port is occupied | Start/status identifies ownership or unavailable port | Stop the known owned process, or choose the documented local port and rerun preflight | Kill an unrelated process by pattern or PID guess |
| Health live fails | Local process is absent/unresponsive | Read local lifecycle logs, stop the owned process, restart once | Repeatedly spawn more servers |
| Health ready fails | Live is up but database/migration/provider posture is invalid | Fix the reported readiness cause, keeping provider OFF, then restart | Ignore readiness and continue review |
| Login/session fails | HTTP login or authenticated route rejects the sanitized account | Confirm seed membership, system time, and key presence; revoke/reseed sanitized sessions if required | Disable session validation or authorization |
| Cross-tenant or agency access appears | Isolation test or UI exposes an unauthorized organization | Stop the review, preserve evidence, enter root-cause handling | Delete evidence or loosen assignment checks |
| Offline content step fails | Deterministic adapter/contract validation rejects input | Correct sanitized input or adapter contract; keep Provider runtime OFF | Enable a real Provider or rerun a canary |
| Backup fails | Backup exits without archive/checksum | Verify local pg tools, free space, role permissions, and exact runtime target | Back up `.env.local`, secrets, or another project database |
| Restore verification fails | Checksum, restore, or readback comparison fails | Preserve archive/log, ensure target is only `geoplane_local_restore_verify`, retry once after root cause | Restore over runtime or use force to hide a populated-target error |
| Stop fails | Status shows the recorded process/port remains | Inspect the lifecycle state file, terminate only that verified process, recheck port | Broadly terminate Node/PostgreSQL processes |
| Security scan fails | Scanner reports file and rule | Remove secret/customer data or correct safe prose; rotate exposed credentials out of band | Add an allowlist for a real secret or weaken the scanner |
| Full test/build failure | Gate exits nonzero | Capture stable reproduction and focused scope, fix twice at most | Skip core E2E or report PASS |

If runtime data may be at risk, stop the application, take a new read-only backup if possible, preserve the latest verified archive, and do not mutate the runtime database until a fresh reviewer confirms the recovery path.
