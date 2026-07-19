/** LOCAL_ENVIRONMENT_RUNTIME_V1 — stop only the PID recorded by local:start. */
import { unlinkSync } from "node:fs";
import { isProcessAlive, readState, stateFile, waitFor } from "./runtime-lib.mjs";

const state = readState();
if (!state) {
  console.log("local:stop: already stopped (no managed process state)");
  process.exit(0);
}

if (isProcessAlive(state.pid)) {
  process.kill(state.pid, "SIGTERM");
  const stopped = await waitFor(() => !isProcessAlive(state.pid), 10_000, 250);
  if (!stopped) {
    console.error(`local:stop: pid=${state.pid} did not stop; refusing to force-kill automatically.`);
    process.exit(1);
  }
}

try {
  unlinkSync(stateFile);
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
console.log(`local:stop: stopped pid=${state.pid}; application data was not modified.`);
