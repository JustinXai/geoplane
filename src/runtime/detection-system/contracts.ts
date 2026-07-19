/**
 * Minimal boundary between the domestic GEO delivery system and a future,
 * independently operated detection system. This module is contracts-only:
 * it intentionally contains no probe runner, provider client, or persistence.
 */
export interface ExternalDetectionProjectRef {
  readonly externalSystem: string;
  readonly externalProjectId: string;
}

export interface DetectionReportRef extends ExternalDetectionProjectRef {
  readonly externalReportId: string;
  readonly generatedAt: string;
}

export interface DetectionSummarySnapshot extends DetectionReportRef {
  readonly capturedAt: string;
  readonly status: "PENDING" | "AVAILABLE" | "UNAVAILABLE";
  readonly summary: Readonly<Record<string, string | number | boolean | null>>;
}

export interface DetectionSystemAdapter {
  getProjectReference(projectId: string): Promise<ExternalDetectionProjectRef | null>;
  getLatestReport(project: ExternalDetectionProjectRef): Promise<DetectionReportRef | null>;
  getSummary(report: DetectionReportRef): Promise<DetectionSummarySnapshot | null>;
}
