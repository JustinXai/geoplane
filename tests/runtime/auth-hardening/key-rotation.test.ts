/**
 * SESSION_ROTATION_AND_REVOCATION_V1 (part 1) — signing-key rotation.
 *
 * Proves the rotation contract documented in session-signing.ts:
 *   - a cookie signed with the PREVIOUS key still verifies while a rotation window is open;
 *   - NEW cookies are always signed with the CURRENT key (a fresh cookie verifies under CURRENT,
 *     not under the old key);
 *   - a cookie signed with a key that is neither CURRENT nor PREVIOUS (a retired/unknown key) is
 *     rejected;
 *   - once PREVIOUS is cleared (the rotation window has elapsed), the old key is fully retired and
 *     its cookies are rejected.
 *
 * The keys are pinned via the __setSessionSigningKeysForTests seam so rotation is exercised
 * deterministically without mutating process.env or leaking a real secret.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  __setSessionSigningKeysForTests,
  signSessionCookieValue,
  verifySessionCookieValue,
} from "../../../src/lib/session-signing.js";
import {
  decodeSessionCookie,
  type AcceptanceSessionCookiePayload,
} from "../../../src/lib/session-cookie.js";

const KEY_A_OLD = "rotation-test-key-A-the-previous-generation-000000";
const KEY_B_NEW = "rotation-test-key-B-the-current-generation-0000000";
const KEY_C_UNKNOWN = "rotation-test-key-C-never-configured-anywhere-0000";

const PAYLOAD: AcceptanceSessionCookiePayload = {
  actorUserId: "user_rotation",
  role: "CLIENT_OWNER",
  organizationId: "org_rotation",
  organizationType: "CLIENT",
  activeClientOrganizationId: "org_rotation",
};

function segment(payload: AcceptanceSessionCookiePayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

describe("SESSION_ROTATION_AND_REVOCATION_V1 — signing-key rotation", () => {
  afterEach(() => {
    __setSessionSigningKeysForTests(null);
  });

  it("accepts a cookie signed with the PREVIOUS key during a rotation window", () => {
    // A cookie was signed under key A. Then the deployment rotated: A -> PREVIOUS, B -> CURRENT.
    const cookieUnderOldKey = signSessionCookieValue(segment(PAYLOAD), { key: KEY_A_OLD });
    __setSessionSigningKeysForTests({ current: KEY_B_NEW, previous: KEY_A_OLD });

    // It still verifies (accepted via PREVIOUS) and decodes to the original payload — the user is
    // not logged out mid-session by the rotation.
    expect(verifySessionCookieValue(cookieUnderOldKey)).not.toBeNull();
    expect(decodeSessionCookie(cookieUnderOldKey)).toEqual(PAYLOAD);
  });

  it("signs NEW cookies with CURRENT, not with the previous key", () => {
    __setSessionSigningKeysForTests({ current: KEY_B_NEW, previous: KEY_A_OLD });
    const fresh = signSessionCookieValue(segment(PAYLOAD));

    // The fresh cookie verifies under the CURRENT key alone but NOT under the previous key alone,
    // proving new cookies are signed with CURRENT.
    expect(verifySessionCookieValue(fresh, { key: KEY_B_NEW })).not.toBeNull();
    expect(verifySessionCookieValue(fresh, { key: KEY_A_OLD })).toBeNull();
  });

  it("rejects a cookie signed with a retired / unknown key (neither CURRENT nor PREVIOUS)", () => {
    __setSessionSigningKeysForTests({ current: KEY_B_NEW, previous: KEY_A_OLD });
    const forged = signSessionCookieValue(segment(PAYLOAD), { key: KEY_C_UNKNOWN });

    expect(verifySessionCookieValue(forged)).toBeNull();
    expect(decodeSessionCookie(forged)).toBeNull();
  });

  it("rejects an old-key cookie once the rotation window has closed (PREVIOUS cleared)", () => {
    const cookieUnderOldKey = signSessionCookieValue(segment(PAYLOAD), { key: KEY_A_OLD });

    // Rotation window fully elapsed: PREVIOUS is cleared, only CURRENT remains honoured.
    __setSessionSigningKeysForTests({ current: KEY_B_NEW, previous: null });

    expect(verifySessionCookieValue(cookieUnderOldKey)).toBeNull();
    expect(decodeSessionCookie(cookieUnderOldKey)).toBeNull();
  });

  it("with no PREVIOUS configured, only the CURRENT key is accepted", () => {
    __setSessionSigningKeysForTests({ current: KEY_B_NEW, previous: null });

    const underCurrent = signSessionCookieValue(segment(PAYLOAD));
    const underOther = signSessionCookieValue(segment(PAYLOAD), { key: KEY_A_OLD });

    expect(verifySessionCookieValue(underCurrent)).not.toBeNull();
    expect(verifySessionCookieValue(underOther)).toBeNull();
  });
});
