/**
 * HMAC-SHA256 signing/verification for the session cookie (checkpoint SIGNED_SESSION_COOKIE_V1).
 *
 * The acceptance-phase cookie (session-cookie.ts) was a plain base64url JSON blob: unsigned and
 * trivially forgeable. This module closes that WARN by signing the cookie's canonical bytes with an
 * HMAC keyed on a server-only secret and by carrying an absolute expiry, so a hand-forged or
 * tampered cookie — or one signed with a different/rotated key, or one past its TTL — fails
 * verification and is rejected as "no session".
 *
 * Token layout (all four segments joined by "."):
 *   `${base64url(payloadJson)}.${issuedAt}.${expiresAt}.${signatureBase64url}`
 * The signature is HMAC-SHA256 over the first three segments (the "signing input"). Verification
 * recomputes the HMAC with the current key and compares it in constant time, then rejects an
 * expired token. Nothing here throws on bad input: verify returns null so callers treat a
 * missing/tampered/expired/wrong-key/malformed cookie as an absent session.
 *
 * Key loading (never commits a secret): SESSION_SIGNING_KEY_CURRENT is read from process.env first,
 * then from a gitignored .env.local at the repo root (same precedence as persistence/config.ts). In
 * production a missing key fails closed (throws when the key is first needed); in dev/test it falls
 * back to a clearly-labelled INSECURE key with a one-time warning so local flows still work.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Absolute session lifetime applied when signing a new cookie: 12 hours (in milliseconds). */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

const KEY_ENV_VAR = "SESSION_SIGNING_KEY_CURRENT";

/**
 * The dev/test fallback used ONLY when no real key is configured and NODE_ENV is not production.
 * It is intentionally obvious and worthless: it must never be relied on for real security.
 */
const INSECURE_DEV_KEY =
  "geoplane-INSECURE-dev-session-signing-key-DO-NOT-USE-IN-PRODUCTION";

// ---------------------------------------------------------------------------
// Key resolution (process.env, then .env.local; fail-closed in production)
// ---------------------------------------------------------------------------

let cachedKey: string | null = null;
let warnedAboutInsecureKey = false;

/** Repo root = two levels up from src/lib. */
function repoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

/** Minimal KEY=VALUE reader for a single var (mirrors persistence/config.ts; no interpolation). */
function readVarFromEnvFile(path: string, name: string): string | null {
  if (!existsSync(path)) return null;
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (key !== name) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    return value.trim() === "" ? null : value.trim();
  }
  return null;
}

function resolveConfiguredKey(): string | null {
  const fromEnv = process.env[KEY_ENV_VAR];
  if (fromEnv && fromEnv.trim() !== "") return fromEnv.trim();
  return readVarFromEnvFile(resolve(repoRoot(), ".env.local"), KEY_ENV_VAR);
}

/**
 * Resolves the active signing key, caching the result. Fail-closed in production: a missing key
 * throws. In dev/test a missing key falls back to the labelled insecure key with a one-time warning.
 */
function loadSigningKey(): string {
  if (cachedKey !== null) return cachedKey;

  const configured = resolveConfiguredKey();
  if (configured) {
    cachedKey = configured;
    return cachedKey;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      `${KEY_ENV_VAR} is required in production but is not set; refusing to sign sessions with an insecure key.`,
    );
  }

  if (!warnedAboutInsecureKey) {
    // Never print the key itself; just flag that an insecure fallback is in effect.
    // eslint-disable-next-line no-console
    console.warn(
      `[session-signing] ${KEY_ENV_VAR} is not set; using an INSECURE dev fallback key. Do NOT use this in production.`,
    );
    warnedAboutInsecureKey = true;
  }

  cachedKey = INSECURE_DEV_KEY;
  return cachedKey;
}

// ---------------------------------------------------------------------------
// Signing / verification
// ---------------------------------------------------------------------------

function computeSignature(signingInput: string, key: string): string {
  return createHmac("sha256", key).update(signingInput, "utf8").digest("base64url");
}

/** Length-checked constant-time comparison (timingSafeEqual requires equal-length buffers). */
function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export interface SignOptions {
  /** Issue time (ms epoch). Defaults to Date.now(). */
  readonly now?: number;
  /** Absolute lifetime (ms). Defaults to SESSION_TTL_MS. Ignored when `expiresAt` is given. */
  readonly ttlMs?: number;
  /** Explicit expiry (ms epoch); overrides ttlMs. Primarily a test seam for expired tokens. */
  readonly expiresAt?: number;
  /** Override the signing key. Primarily a test seam for wrong-key rejection. */
  readonly key?: string;
}

/**
 * Signs the already-base64url-encoded payload bytes into a full session cookie value.
 * Callers pass `base64url(JSON.stringify(payload))`; this appends the issued/expiry timestamps and
 * the HMAC signature.
 */
export function signSessionCookieValue(payloadB64Url: string, opts: SignOptions = {}): string {
  const key = opts.key ?? loadSigningKey();
  const issuedAt = opts.now ?? Date.now();
  const expiresAt = opts.expiresAt ?? issuedAt + (opts.ttlMs ?? SESSION_TTL_MS);
  const signingInput = `${payloadB64Url}.${issuedAt}.${expiresAt}`;
  const signature = computeSignature(signingInput, key);
  return `${signingInput}.${signature}`;
}

export interface VerifyOptions {
  /** Current time (ms epoch) used for the expiry check. Defaults to Date.now(). */
  readonly now?: number;
  /** Override the verification key. Primarily a test seam. */
  readonly key?: string;
}

/**
 * Verifies a session cookie value: checks the signature (constant-time) against the current key and
 * rejects an expired token. Returns the embedded base64url payload segment on success, or null for
 * any failure (malformed, tampered, wrong key, expired). Never throws.
 */
export function verifySessionCookieValue(
  value: string | undefined | null,
  opts: VerifyOptions = {},
): string | null {
  if (!value) return null;

  const parts = value.split(".");
  if (parts.length !== 4) return null;

  const payloadB64Url = parts[0];
  const issuedAtRaw = parts[1];
  const expiresAtRaw = parts[2];
  const signature = parts[3];
  if (
    payloadB64Url === undefined ||
    issuedAtRaw === undefined ||
    expiresAtRaw === undefined ||
    signature === undefined ||
    payloadB64Url === ""
  ) {
    return null;
  }

  const key = opts.key ?? loadSigningKey();
  const signingInput = `${payloadB64Url}.${issuedAtRaw}.${expiresAtRaw}`;
  const expected = computeSignature(signingInput, key);
  if (!constantTimeEquals(signature, expected)) return null;

  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt)) return null;
  const now = opts.now ?? Date.now();
  if (now >= expiresAt) return null;

  return payloadB64Url;
}
