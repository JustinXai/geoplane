import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const VERSION = "1";
const COST = 16_384;
const BLOCK_SIZE = 8;
const PARALLELIZATION = 1;
const KEY_LENGTH = 32;
const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_BYTES = 1024;

// Valid work factor and fixed non-secret bytes. Used only to equalize the expensive verification
// path when an email is unknown or an account has not been provisioned; it authenticates nobody.
export const NON_AUTHENTICATING_PASSWORD_HASH =
  "scrypt$1$16384$8$1$bG9jYWwtYXV0aC1ub24tYXV0aGVudGljYXRpbmc$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

function derive(password: string, salt: Buffer, cost = COST): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      KEY_LENGTH,
      { N: cost, r: BLOCK_SIZE, p: PARALLELIZATION, maxmem: 64 * 1024 * 1024 },
      (error, key) => (error ? reject(error) : resolve(key)),
    );
  });
}

export function assertPasswordPolicy(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH || Buffer.byteLength(password, "utf8") > MAX_PASSWORD_BYTES) {
    throw new Error(`password must be at least ${MIN_PASSWORD_LENGTH} characters and at most ${MAX_PASSWORD_BYTES} bytes`);
  }
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
    throw new Error("password must contain lowercase, uppercase, and numeric characters");
  }
}

export async function hashPassword(password: string, salt = randomBytes(16)): Promise<string> {
  assertPasswordPolicy(password);
  const key = await derive(password, salt);
  return [
    "scrypt",
    VERSION,
    String(COST),
    String(BLOCK_SIZE),
    String(PARALLELIZATION),
    salt.toString("base64url"),
    key.toString("base64url"),
  ].join("$");
}

interface ParsedHash {
  readonly cost: number;
  readonly salt: Buffer;
  readonly expected: Buffer;
}

function parse(encoded: string): ParsedHash | null {
  const parts = encoded.split("$");
  if (
    parts.length !== 7 ||
    parts[0] !== "scrypt" ||
    parts[1] !== VERSION ||
    parts[2] !== String(COST) ||
    parts[3] !== String(BLOCK_SIZE) ||
    parts[4] !== String(PARALLELIZATION)
  ) {
    return null;
  }
  try {
    const salt = Buffer.from(parts[5]!, "base64url");
    const expected = Buffer.from(parts[6]!, "base64url");
    if (salt.length < 16 || expected.length !== KEY_LENGTH) return null;
    return { cost: COST, salt, expected };
  } catch {
    return null;
  }
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parsed = parse(encoded) ?? parse(NON_AUTHENTICATING_PASSWORD_HASH)!;
  const actual = await derive(password.slice(0, MAX_PASSWORD_BYTES), parsed.salt, parsed.cost);
  const validEncoding = parse(encoded) !== null;
  return validEncoding && timingSafeEqual(actual, parsed.expected);
}
