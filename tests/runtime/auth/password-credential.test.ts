import { describe, expect, it } from "vitest";
import {
  hashPassword,
  verifyPassword,
} from "../../../src/runtime/auth/password-credential.js";
import { TEST_LOGIN_PASSWORD, TEST_LOGIN_PASSWORD_HASH } from "../../helpers/auth-credentials.js";

describe("LOCAL_CREDENTIAL_AUTH_V1 password digests", () => {
  it("verifies the deterministic test digest and rejects a wrong password", async () => {
    await expect(verifyPassword(TEST_LOGIN_PASSWORD, TEST_LOGIN_PASSWORD_HASH)).resolves.toBe(true);
    await expect(verifyPassword("Wrong-Password-2026", TEST_LOGIN_PASSWORD_HASH)).resolves.toBe(false);
  });

  it("creates a salted versioned digest without retaining plaintext", async () => {
    const digest = await hashPassword("Another-Local-Password-2026");
    expect(digest).toMatch(/^scrypt\$1\$16384\$8\$1\$/);
    expect(digest).not.toContain("Another-Local-Password-2026");
    await expect(verifyPassword("Another-Local-Password-2026", digest)).resolves.toBe(true);
  });

  it("fails closed for malformed digests", async () => {
    await expect(verifyPassword(TEST_LOGIN_PASSWORD, "not-a-digest")).resolves.toBe(false);
  });
});
