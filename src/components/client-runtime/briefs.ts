"use client";

/**
 * BRIEF_RUNTIME_V1 (Agent B) — brief read loaders and navigation helpers.
 *
 * Loads from the real brief routes and maps results to the frozen ArticleBriefViewV1.
 * All helpers are tenant-scoped via server-side session resolution.
 */
import type { ArticleBriefViewV1 } from "../../runtime/commands/geo-dto.js";
import { defaultApiClient, type Result } from "../../lib/api-client/http.js";

/** List all briefs for the authenticated client (GET /api/article-briefs). */
export function loadBriefs(): Promise<Result<readonly ArticleBriefViewV1[]>> {
  return defaultApiClient.request<readonly ArticleBriefViewV1[]>("/api/article-briefs");
}

/** Load one brief by id (GET /api/article-briefs/[id]). */
export function loadBrief(id: string): Promise<Result<ArticleBriefViewV1>> {
  return defaultApiClient.request<ArticleBriefViewV1>(
    `/api/article-briefs/${encodeURIComponent(id)}`,
  );
}
