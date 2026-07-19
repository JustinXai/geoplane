/** Existing manual Probe implementation retained as an isolated prototype. */
export const PROBE_RUNTIME_CLASSIFICATION = "INDEPENDENT_DETECTION_SYSTEM_PROTOTYPE" as const;
export const OBSERVATION_GAP_DISPOSITION = "DEFERRED_TO_INDEPENDENT_DETECTION_SYSTEM" as const;

/** The prototype is fail-closed and never appears in the primary product by default. */
export function isIndependentDetectionPrototypeEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env.NEXT_PUBLIC_INDEPENDENT_DETECTION_PROTOTYPE_ENABLED?.trim().toUpperCase() === "TRUE";
}
