/**
 * Feature flags for detection and publication executor UI features.
 * Control visibility of UI components and pages.
 */
export const DOMESTIC_DETECTION_ENABLED =
  process.env.NEXT_PUBLIC_DOMESTIC_DETECTION_ENABLED?.trim().toUpperCase() === "TRUE";

export const PUBLICATION_EXECUTOR_ENABLED =
  process.env.NEXT_PUBLIC_PUBLICATION_EXECUTOR_ENABLED?.trim().toUpperCase() === "TRUE";
