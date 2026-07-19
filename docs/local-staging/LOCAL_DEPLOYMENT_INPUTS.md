# LOCAL CLOSED-PILOT DEPLOYMENT INPUTS

Variable names, purpose, and readiness status only. Values belong in the gitignored `.env.local` or an out-of-band local secret store and must never be printed or committed.

| Variable | Purpose | Required posture | Status |
| --- | --- | --- | --- |
| `GEO_DATABASE_URL` | Local pilot runtime database | Database name exactly `geoplane_local_runtime`; dedicated non-superuser role | NOT_VERIFIED |
| `GEO_TEST_DATABASE_URL` | Destructive automated-test database | Database name exactly `geoplane_local_test`; distinct from runtime/canary | NOT_VERIFIED |
| `GEO_CANARY_DATABASE_URL` | Isolated canary-purpose database | Database name exactly `geoplane_local_canary`; no canary execution in this phase | NOT_VERIFIED |
| `SESSION_SIGNING_KEY_CURRENT` | Signs new local session cookies | Present; strong; value never logged | NOT_VERIFIED |
| `SESSION_SIGNING_KEY_PREVIOUS` | Routine rotation overlap | Present only during a controlled window; value never logged | NOT_APPLICABLE |
| `REVIEW_REFERENCE_KEY_CURRENT` | Signs opaque review references | Present; value never logged | NOT_VERIFIED |
| `REVIEW_REFERENCE_KEY_PREVIOUS` | Review-reference rotation overlap | Present only during a controlled window; value never logged | NOT_APPLICABLE |
| `PROVIDER_RUNTIME_ENABLED` | Real Provider feature gate | Exactly `false` for this entire phase | NOT_VERIFIED |
| `PORT` | Local application port | Available and documented without killing unrelated processes | NOT_VERIFIED |
| `LOCAL_BACKUP_DIR` | Local database archive/checksum destination | Outside Git; enough free space; no secret files | NOT_VERIFIED |

Prohibited inputs:

- No Provider API key is required or permitted for this stage.
- No real customer record or document is required or permitted.
- No remote Git credential is required.
- Never place a full database URL, password, signing key, session token, or Provider key in committed files or reports.

Acceptance requires preflight to report each required variable by name and safe status only, database role separation PASS, migrations `0001`–`0008` current, and Provider runtime OFF.
