/** LOCAL_ENVIRONMENT_RUNTIME_V1 — one-command, secret-safe local readiness check. */
import { runPreflight } from "./runtime-lib.mjs";

const result = await runPreflight();
if (!result.ok) process.exitCode = 1;
