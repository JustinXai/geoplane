/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * reconstruction_source: docs/governance/SYSTEM_INVARIANTS_V1.md (tenant isolation),
 *   src/lib/workspace-nav.ts
 * reconstruction_reason: no original test source recoverable - see
 *   docs/rebuild/RECOVERY_GAP_ANALYSIS.md ("Test suite - Not recovered as files")
 * original_file_unavailable: true
 *
 * Exercises the C1 shell's presentation-layer tenant isolation: each
 * workspace surface's nav fixture must only ever link within its own
 * surface, matching SYSTEM_INVARIANTS_V1 "Tenant isolation". A CLIENT-
 * surface nav must never link into /agency/* or /ops/*, and vice versa.
 */
import { describe, expect, it } from "vitest";
import {
  AGENCY_WORKSPACE_NAV_LINKS,
  CLIENT_WORKSPACE_NAV_LINKS,
  OPS_WORKSPACE_NAV_LINKS,
  assertSurfaceIsolatedLinks,
  isLinkWithinSurface,
} from "../src/lib/workspace-nav.js";

describe("workspace nav tenant isolation (checkpoint C1 shell)", () => {
  it("client (/app) surface nav has links, all within /app, none into /agency or /ops", () => {
    expect(CLIENT_WORKSPACE_NAV_LINKS.length).toBeGreaterThan(0);
    for (const link of CLIENT_WORKSPACE_NAV_LINKS) {
      expect(link.href.startsWith("/app")).toBe(true);
      expect(link.href.startsWith("/agency")).toBe(false);
      expect(link.href.startsWith("/ops")).toBe(false);
    }
  });

  it("agency surface nav has links, all within /agency, none into /app or /ops", () => {
    expect(AGENCY_WORKSPACE_NAV_LINKS.length).toBeGreaterThan(0);
    for (const link of AGENCY_WORKSPACE_NAV_LINKS) {
      expect(link.href.startsWith("/agency")).toBe(true);
      expect(link.href.startsWith("/app")).toBe(false);
      expect(link.href.startsWith("/ops")).toBe(false);
    }
  });

  it("ops surface nav has links, all within /ops, none into /app or /agency", () => {
    expect(OPS_WORKSPACE_NAV_LINKS.length).toBeGreaterThan(0);
    for (const link of OPS_WORKSPACE_NAV_LINKS) {
      expect(link.href.startsWith("/ops")).toBe(true);
      expect(link.href.startsWith("/app")).toBe(false);
      expect(link.href.startsWith("/agency")).toBe(false);
    }
  });

  it("isLinkWithinSurface distinguishes same-surface from cross-surface hrefs", () => {
    expect(isLinkWithinSurface("app", "/app/projects")).toBe(true);
    expect(isLinkWithinSurface("app", "/agency/clients")).toBe(false);
    expect(isLinkWithinSurface("app", "/ops/audit")).toBe(false);
    expect(isLinkWithinSurface("ops", "/ops")).toBe(true);
    // "/appendix" must not falsely match the "/app" prefix.
    expect(isLinkWithinSurface("app", "/appendix")).toBe(false);
  });

  it("assertSurfaceIsolatedLinks throws when a fixture crosses surfaces", () => {
    expect(() =>
      assertSurfaceIsolatedLinks("app", [{ label: "bad", href: "/ops/audit" }]),
    ).toThrow(/Tenant isolation violation/);
  });
});
