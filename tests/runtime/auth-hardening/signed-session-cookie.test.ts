/**
 * SIGNED_SESSION_COOKIE_V1 — proves the session cookie is now HMAC-signed with an absolute expiry,
 * and that forged / tampered / expired / wrong-key / unsigned cookies are all rejected (decode
 * returns null, never throws). Also asserts sessionSetCookie/sessionClearCookie emit the hardened
 * attributes (HttpOnly, SameSite=Lax, Max-Age, and Secure only outside local dev).
 *
 * These use the public API of session-cookie.ts (unchanged) plus the low-level signing seams from
 * session-signing.ts to synthesize expired / wrong-key tokens without waiting or leaking a key.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  decodeSessionCookie,
  encodeSessionCookie,
  type AcceptanceSessionCookiePayload,
} from "../../../src/lib/session-cookie.js";
import { signSessionCookieValue } from "../../../src/lib/session-signing.js";
import { sessionClearCookie, sessionSetCookie } from "../../../src/runtime/auth/http.js";

const PAYLOAD: AcceptanceSessionCookiePayload = {
  actorUserId: "user_client_owner",
  role: "CLIENT_OWNER",
  organizationId: "org_client_1",
  organizationType: "CLIENT",
  activeClientOrganizationId: "org_client_1",
};

/** base64url(JSON(payload)) — the exact payload segment encodeSessionCookie signs over. */
function payloadSegment(payload: AcceptanceSessionCookiePayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

describe("SIGNED_SESSION_COOKIE_V1 — signed session cookie encode/decode", () => {
  it("a valid signed cookie round-trips exactly through encode -> decode", () => {
    const encoded = encodeSessionCookie(PAYLOAD);
    // A signed token has four dot-separated segments: payload.issuedAt.expiresAt.signature.
    expect(encoded.split(".")).toHaveLength(4);
    expect(decodeSessionCookie(encoded)).toEqual(PAYLOAD);
  });

  it("rejects a tampered signature (decode -> null)", () => {
    const parts = encodeSessionCookie(PAYLOAD).split(".");
    const sig = parts[3]!;
    const flipped = (sig[0] === "A" ? "B" : "A") + sig.slice(1);
    const tampered = [parts[0], parts[1], parts[2], flipped].join(".");
    expect(tampered).not.toBe(encodeSessionCookie(PAYLOAD));
    expect(decodeSessionCookie(tampered)).toBeNull();
  });

  it("rejects a tampered payload segment (signature no longer matches -> null)", () => {
    const parts = encodeSessionCookie(PAYLOAD).split(".");
    const forgedPayload = payloadSegment({ ...PAYLOAD, role: "PLATFORM_SUPER_ADMIN" });
    const tampered = [forgedPayload, parts[1], parts[2], parts[3]].join(".");
    expect(decodeSessionCookie(tampered)).toBeNull();
  });

  it("rejects an expired cookie (decode -> null)", () => {
    // Signed with the real current key but an expiry in the past: signature is valid, TTL is not.
    const expired = signSessionCookieValue(payloadSegment(PAYLOAD), {
      expiresAt: Date.now() - 60_000,
    });
    expect(decodeSessionCookie(expired)).toBeNull();
  });

  it("rejects a cookie signed with a different key (decode -> null)", () => {
    const wrongKey = signSessionCookieValue(payloadSegment(PAYLOAD), {
      key: "a-completely-different-signing-key-not-the-server-secret",
    });
    expect(decodeSessionCookie(wrongKey)).toBeNull();
  });

  it("rejects a plain (unsigned) base64url JSON blob — the old forgeable format", () => {
    const unsigned = payloadSegment(PAYLOAD); // exactly what the pre-signing encoder produced
    expect(decodeSessionCookie(unsigned)).toBeNull();
  });

  it("rejects missing / empty / structurally malformed values (never throws)", () => {
    expect(decodeSessionCookie(undefined)).toBeNull();
    expect(decodeSessionCookie(null)).toBeNull();
    expect(decodeSessionCookie("")).toBeNull();
    expect(decodeSessionCookie("only.three.parts")).toBeNull();
    expect(decodeSessionCookie("way.too.many.dot.parts")).toBeNull();
  });
});

describe("SIGNED_SESSION_COOKIE_V1 — Set-Cookie attributes", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sessionSetCookie carries HttpOnly, SameSite=Lax, Path=/ and a positive Max-Age", () => {
    vi.stubEnv("NODE_ENV", "development");
    const cookie = sessionSetCookie("geo_acceptance_session", encodeSessionCookie(PAYLOAD));
    expect(cookie).toContain("geo_acceptance_session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).toMatch(/Max-Age=\d+/);
    const maxAge = Number(/Max-Age=(\d+)/.exec(cookie)?.[1]);
    expect(maxAge).toBeGreaterThan(0);
  });

  it("omits Secure in local dev but sets it in production/staging", () => {
    const value = encodeSessionCookie(PAYLOAD);

    vi.stubEnv("NODE_ENV", "development");
    expect(sessionSetCookie("geo_acceptance_session", value)).not.toContain("Secure");

    vi.stubEnv("NODE_ENV", "production");
    expect(sessionSetCookie("geo_acceptance_session", value)).toContain("Secure");

    vi.stubEnv("NODE_ENV", "staging");
    expect(sessionSetCookie("geo_acceptance_session", value)).toContain("Secure");
  });

  it("omits Secure in production only for the exact managed loopback-only posture", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LOCAL_ONLY_MODE", "TRUE");
    vi.stubEnv("REMOTE_WRITE", "FORBIDDEN");
    vi.stubEnv("LOCAL_APP_HOST", "127.0.0.1");
    vi.stubEnv("LOCAL_SESSION_COOKIE_SECURE", "false");
    const value = "signed-cookie-value";
    expect(sessionSetCookie("geo_acceptance_session", value)).not.toContain("; Secure");
    expect(sessionSetCookie("geo_acceptance_session", value)).toContain("HttpOnly");
    expect(sessionSetCookie("geo_acceptance_session", value)).toContain("SameSite=Lax");

    for (const [name, changed] of [
      ["LOCAL_ONLY_MODE", "true"],
      ["REMOTE_WRITE", "ALLOWED"],
      ["LOCAL_APP_HOST", "0.0.0.0"],
      ["LOCAL_SESSION_COOKIE_SECURE", "true"],
    ] as const) {
      vi.stubEnv("LOCAL_ONLY_MODE", "TRUE");
      vi.stubEnv("REMOTE_WRITE", "FORBIDDEN");
      vi.stubEnv("LOCAL_APP_HOST", "127.0.0.1");
      vi.stubEnv("LOCAL_SESSION_COOKIE_SECURE", "false");
      vi.stubEnv(name, changed);
      expect(sessionSetCookie("geo_acceptance_session", value)).toContain("; Secure");
    }
  });

  it("sessionClearCookie clears with Max-Age=0 and the same hardened attributes", () => {
    vi.stubEnv("NODE_ENV", "development");
    const cleared = sessionClearCookie("geo_acceptance_session");
    expect(cleared).toContain("geo_acceptance_session=;");
    expect(cleared).toContain("HttpOnly");
    expect(cleared).toContain("SameSite=Lax");
    expect(cleared).toContain("Max-Age=0");
    expect(cleared).not.toContain("Secure");
  });
});
