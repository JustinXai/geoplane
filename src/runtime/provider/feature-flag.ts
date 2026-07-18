/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC (net-new runtime-phase file)
 * reconstruction_reason: PROVIDER_PORT_AND_CONTRACT_V1 (checkpoint D1) — the
 *   feature flag that keeps the controlled-provider runtime OFF by default, plus
 *   the guard that refuses a real provider call while it is off.
 * original_file_unavailable: n/a (net-new runtime-phase file)
 *
 * Default-OFF discipline: the provider runtime is disabled unless
 * PROVIDER_RUNTIME_ENABLED is set to an explicit truthy value ("true" or "1",
 * case-insensitive). Anything else — unset, empty, "false", "0", "no",
 * garbage — resolves to OFF. This makes "off" the safe default that survives a
 * missing/misconfigured environment, rather than something that has to be
 * actively asserted.
 *
 * `.env.local` in this repo sets PROVIDER_RUNTIME_ENABLED=false explicitly; the
 * Next.js server loads that into process.env, so the running app is OFF. This
 * checkpoint is FULLY OFFLINE regardless: no real network call is made from any
 * code path here.
 */
import { ProviderErrorCode } from "./errors.js";

export const PROVIDER_RUNTIME_ENABLED_ENV_VAR = "PROVIDER_RUNTIME_ENABLED";

/** The only values that turn the runtime ON (compared case-insensitively). */
const TRUTHY_VALUES: ReadonlySet<string> = new Set(["true", "1"]);

/**
 * Is the controlled-provider runtime enabled? Reads
 * `PROVIDER_RUNTIME_ENABLED` from the given env (defaults to `process.env`).
 * Default is FALSE: only an explicit "true"/"1" enables it.
 *
 * The env is a parameter (not hard-wired to `process.env`) so tests can drive
 * every case with a plain object and never mutate global process state.
 */
export function isProviderRuntimeEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  const raw = env[PROVIDER_RUNTIME_ENABLED_ENV_VAR];
  if (typeof raw !== "string") return false;
  return TRUTHY_VALUES.has(raw.trim().toLowerCase());
}

/**
 * Thrown when a REAL provider call is attempted while the runtime is disabled.
 * Carries the `PROVIDER_UNAVAILABLE` taxonomy code so a caller that prefers a
 * result over an exception can map it onto `providerErr(...)`.
 */
export class ProviderRuntimeDisabledError extends Error {
  readonly code: ProviderErrorCode.PROVIDER_UNAVAILABLE = ProviderErrorCode.PROVIDER_UNAVAILABLE;

  constructor(message?: string) {
    super(
      message ??
        "Provider runtime is disabled (PROVIDER_RUNTIME_ENABLED is not enabled); " +
          "a real provider call was refused. This is the default-OFF safety guard.",
    );
    this.name = "ProviderRuntimeDisabledError";
  }
}

/**
 * Guard every REAL (network) provider call site with this first. Throws
 * `ProviderRuntimeDisabledError` (code `PROVIDER_UNAVAILABLE`) when the runtime
 * is disabled, so a real call can never slip through while the flag is off.
 *
 * The offline deterministic adapter deliberately does NOT call this: it makes
 * no network call, so it is safe to run as the default while the flag is off.
 * Only adapters that would actually reach the network (the D2 real adapter)
 * must call this before doing so.
 */
export function assertRealProviderCallAllowed(
  env: Readonly<Record<string, string | undefined>> = process.env,
): void {
  if (!isProviderRuntimeEnabled(env)) {
    throw new ProviderRuntimeDisabledError();
  }
}
