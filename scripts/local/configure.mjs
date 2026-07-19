/**
 * LOCAL_ENVIRONMENT_RUNTIME_V1 — configure the gitignored local environment without logging
 * values. Inputs are read only from the current process environment.
 */
import { repoRoot, sanitizedError } from "./runtime-lib.mjs";
import { validateLocalConfiguration, writeLocalConfigurationAtomic } from "./configure-lib.mjs";

try {
  const values = validateLocalConfiguration(process.env);
  const checkOnly = process.argv.includes("--check");
  if (!checkOnly) writeLocalConfigurationAtomic(repoRoot, values);
  for (const name of [
    "GEO_DATABASE_URL",
    "GEO_TEST_DATABASE_URL",
    "GEO_CANARY_DATABASE_URL",
    "SESSION_SIGNING_KEY_CURRENT",
    "SESSION_SIGNING_KEY_PREVIOUS",
    "REVIEW_REFERENCE_KEY_CURRENT",
    "LOCAL_PLATFORM_ADMIN_PASSWORD",
    "LOCAL_AGENCY_OWNER_PASSWORD",
    "LOCAL_CLIENT_OWNER_PASSWORD",
    "PROVIDER_RUNTIME_ENABLED",
    "LOCAL_APP_PORT",
    "LOCAL_BACKUP_DIR",
    "LOCAL_ONLY_MODE",
    "REMOTE_WRITE",
  ]) {
    const state = name === "SESSION_SIGNING_KEY_PREVIOUS" && values[name] === "" ? "EMPTY (rotation closed)" : "VALID (value hidden)";
    console.log(`${name}: ${state}`);
  }
  console.log(checkOnly ? "local:configure: CHECK PASS (no file written)" : "local:configure: PASS (.env.local written atomically)");
} catch (error) {
  console.error(`local:configure: BLOCKED — ${sanitizedError(error)}`);
  process.exitCode = 1;
}
