/** LOCAL_ENVIRONMENT_RUNTIME_V1 — report managed process and health without showing secrets. */
import { health, isProcessAlive, readState, stderrLog, stdoutLog } from "./runtime-lib.mjs";

const state = readState();
if (!state) {
  console.log("local:status: STOPPED (no managed process state)");
  process.exit(1);
}
if (!isProcessAlive(state.pid)) {
  console.log(`local:status: STOPPED (stale state for pid=${state.pid})`);
  process.exit(1);
}

const [live, ready] = await Promise.all([
  health(state.port, "/api/health/live"),
  health(state.port, "/api/health/ready"),
]);
console.log(`local:status: RUNNING pid=${state.pid} url=http://127.0.0.1:${state.port}`);
console.log(`health: live=${live.ok ? "PASS" : `FAIL(${live.status ?? "unreachable"})`} ready=${ready.ok ? "PASS" : `FAIL(${ready.status ?? "unreachable"})`}`);
console.log("provider: OFF (managed process invariant)");
console.log(`logs: stdout=${stdoutLog} stderr=${stderrLog}`);
if (!live.ok || !ready.ok) process.exitCode = 1;
