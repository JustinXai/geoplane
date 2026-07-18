/**
 * STAGING_OPERATIONS_V1 batch 1 (Agent E1) — liveness route.
 *
 * Liveness must always answer 200 {status:"live"} with no dependencies, so it is testable without
 * a database.
 */
import { describe, expect, it } from "vitest";
import { GET as liveRoute } from "../../../src/app/api/health/live/route.js";

describe("GET /api/health/live", () => {
  it("always returns 200 {status:\"live\"}", async () => {
    const res = liveRoute();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: "live" });
  });
});
