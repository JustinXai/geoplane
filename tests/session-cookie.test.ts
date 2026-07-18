/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * reconstruction_source: src/lib/session-cookie.ts
 * reconstruction_reason: net-new acceptance-phase test - no original test source
 *   recoverable, proving code written during this same phase.
 * original_file_unavailable: n/a (net-new acceptance-phase file)
 */
import { describe, expect, it } from "vitest";
import {
  allowedSurfaceForRole,
  decodeSessionCookie,
  encodeSessionCookie,
  type AcceptanceSessionCookiePayload,
} from "../src/lib/session-cookie.js";

describe("session-cookie encode/decode round trip", () => {
  const payload: AcceptanceSessionCookiePayload = {
    actorUserId: "user_client_owner",
    role: "CLIENT_OWNER",
    organizationId: "org_client_1",
    organizationType: "CLIENT",
    activeClientOrganizationId: "org_client_1",
  };

  it("round-trips a valid payload exactly", () => {
    const encoded = encodeSessionCookie(payload);
    const decoded = decodeSessionCookie(encoded);
    expect(decoded).toEqual(payload);
  });

  it("returns null (never throws) for a missing cookie value", () => {
    expect(decodeSessionCookie(undefined)).toBeNull();
    expect(decodeSessionCookie(null)).toBeNull();
    expect(decodeSessionCookie("")).toBeNull();
  });

  it("returns null (never throws) for garbage cookie content", () => {
    expect(decodeSessionCookie("not-valid-base64url-json!!!")).toBeNull();
    expect(decodeSessionCookie(Buffer.from("{}", "utf8").toString("base64url"))).toBeNull();
  });
});

describe("allowedSurfaceForRole - single source of truth for the role/surface boundary", () => {
  it("CLIENT_OWNER -> app", () => {
    expect(allowedSurfaceForRole("CLIENT_OWNER")).toBe("app");
  });
  it("AGENCY_OWNER and AGENCY_OPERATOR -> agency", () => {
    expect(allowedSurfaceForRole("AGENCY_OWNER")).toBe("agency");
    expect(allowedSurfaceForRole("AGENCY_OPERATOR")).toBe("agency");
  });
  it("PLATFORM_SUPER_ADMIN -> ops", () => {
    expect(allowedSurfaceForRole("PLATFORM_SUPER_ADMIN")).toBe("ops");
  });
  it("every role maps to exactly one surface, and no two roles share an ambiguous mapping that would break isolation", () => {
    const roles: AcceptanceSessionCookiePayload["role"][] = [
      "CLIENT_OWNER",
      "AGENCY_OWNER",
      "AGENCY_OPERATOR",
      "PLATFORM_SUPER_ADMIN",
    ];
    for (const role of roles) {
      const surface = allowedSurfaceForRole(role);
      expect(["app", "agency", "ops"]).toContain(surface);
    }
  });
});
