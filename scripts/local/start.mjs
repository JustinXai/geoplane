/** LOCAL_ENVIRONMENT_RUNTIME_V1 — start the production Next.js server on loopback only. */
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  health,
  isProcessAlive,
  localPort,
  readState,
  repoRoot,
  runPreflight,
  sanitizedError,
  spawnManaged,
  waitFor,
  writeState,
} from "./runtime-lib.mjs";

const existing = readState();
if (existing && isProcessAlive(existing.pid)) {
  console.log(`local:start: already running on http://127.0.0.1:${existing.port}`);
  process.exit(0);
}

const preflight = await runPreflight();
if (!preflight.ok) {
  console.error("local:start: preflight failed; no process was started.");
  process.exit(1);
}

if (!existsSync(join(repoRoot, ".next", "BUILD_ID"))) {
  console.error("local:start: production build is missing; run npm run build:web, then retry.");
  process.exit(1);
}

const port = localPort(preflight.environment.resolveValue);
const nextBin = join(repoRoot, "node_modules", "next", "dist", "bin", "next");
const childEnv = {
  ...preflight.environment.merged,
  NODE_ENV: "production",
  PORT: String(port),
  PROVIDER_RUNTIME_ENABLED: "false",
};

const child = spawnManaged(process.execPath, [nextBin, "start", "-H", "127.0.0.1", "-p", String(port)], {
  env: childEnv,
});
const state = { pid: child.pid, port, startedAt: new Date().toISOString(), mode: "next-production-loopback" };
writeState(state);

const ready = await waitFor(async () => {
  if (!isProcessAlive(child.pid)) return false;
  return (await health(port, "/api/health/ready")).ok;
}, 45_000, 500);

if (!ready) {
  if (isProcessAlive(child.pid)) process.kill(child.pid, "SIGTERM");
  console.error("local:start: readiness did not pass within 45 seconds; inspect local status/logs.");
  process.exit(1);
}

try {
  const live = await health(port, "/api/health/live");
  console.log(`local:start: started pid=${child.pid} url=http://127.0.0.1:${port}`);
  console.log(`health: live=${live.ok ? "PASS" : "FAIL"} ready=PASS provider=OFF`);
} catch (error) {
  console.error(`local:start: ${sanitizedError(error, preflight.environment)}`);
  process.exitCode = 1;
}
