/**
 * HMAC-SHA256 signing/verification for the session cookie
 * (checkpoints SIGNED_SESSION_COOKIE_V1 and SESSION_ROTATION_AND_REVOCATION_V1).
 *
 * The acceptance-phase cookie (session-cookie.ts) was a plain base64url JSON blob: unsigned and
 * trivially forgeable. This module closes that WARN by signing the cookie's canonical bytes with an
 * HMAC keyed on a server-only secret and by carrying an absolute expiry, so a hand-forged or
 * tampered cookie — or one signed with a key that is neither the current nor the previous signing
 * key, or one past its TTL — fails verification and is rejected as "no session".
 *
 * Token layout (all four segments joined by "."):
 *   `${base64url(payloadJson)}.${issuedAt}.${expiresAt}.${signatureBase64url}`
 * The signature is HMAC-SHA256 over the first three segments (the "signing input"). Verification
 * recomputes the HMAC with the accepted key(s) and compares it in constant time, then rejects an
 * expired token. Nothing here throws on bad input: verify returns null so callers treat a
 * missing/tampered/expired/wrong-key/malformed cookie as an absent session.
 *
 * ---------------------------------------------------------------------------
 * SIGNING-KEY ROTATION CONTRACT (SESSION_ROTATION_AND_REVOCATION_V1)
 * ---------------------------------------------------------------------------
 * Two env vars back the key material (each read from process.env first, then the gitignored
 * .env.local, exactly like persistence/config.ts — a secret is never committed):
 *   - SESSION_SIGNING_KEY_CURRENT  : the active key. NEW cookies are ALWAYS signed with this.
 *   - SESSION_SIGNING_KEY_PREVIOUS : the immediately-previous key, or empty. Cookies already in
 *                                    the wild that were signed with it still VERIFY, so a rotation
 *                                    does not log every user out mid-session.
 *
 * A signature is accepted iff it matches CURRENT or (when set) PREVIOUS. A cookie signed with any
 * other key — a retired key two generations back, or an attacker's key — is rejected.
 *
 * To rotate:
 *   1. Move the value of SESSION_SIGNING_KEY_CURRENT into SESSION_SIGNING_KEY_PREVIOUS.
 *   2. Set a fresh random secret as the new SESSION_SIGNING_KEY_CURRENT.
 *   3. From that moment new cookies sign with the new CURRENT; still-live cookies signed with the
 *      now-PREVIOUS key keep verifying for the length of the cookie TTL window (SESSION_TTL_MS).
 *   4. After that TTL window has fully elapsed (no valid cookie can still bear the old key), clear
 *      SESSION_SIGNING_KEY_PREVIOUS (set it empty). The old key is now fully retired and any cookie
 *      still bearing it is rejected.
 *
 * Key loading fails closed in production: a missing SESSION_SIGNING_KEY_CURRENT throws when the key
 * is first needed. In dev/test it falls back to a clearly-labelled INSECURE key with a one-time
 * warning so local flows still work.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Absolute session lifetime applied when signing a new cookie: 12 hours (in milliseconds). */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

const CURRENT_KEY_ENV_VAR = "SESSION_SIGNING_KEY_CURRENT";
const PREVIOUS_KEY_ENV_VAR = "SESSION_SIGNING_KEY_PREVIOUS";

/**
 * The dev/test fallback used ONLY when no real key is configured and NODE_ENV is not production.
 * It is intentionally obvious and worthless: it must never be relied on for real security.
 */
const INSECURE_DEV_KEY =
  "geoplane-INSECURE-dev-session-signing-key-DO-NOT-USE-IN-PRODUCTION";

// ---------------------------------------------------------------------------
// Key resolution (process.env, then .env.local; fail-closed in production)
// ---------------------------------------------------------------------------

let cachedCurrentKey: string | null = null;
let cachedPreviousKey: string | null = null;
let previousKeyResolved = false;
let warnedAboutInsecureKey = false;

/**
 * Test seam: overrides the resolved CURRENT/PREVIOUS keys without touching process.env or the
 * cached values, so rotation can be exercised deterministically. Pass null to fall back to the
 * real env-driven resolution. NEVER used outside tests.
 */
let keyOverride: { readonly current: string; readonly previous: string | null } | null = null;

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

/** Resolves a single signing-key env var: process.env first, then .env.local. Null when unset/empty. */
function resolveConfiguredKey(name: string): string | null {
  const fromEnv = process.env[name];
  if (fromEnv && fromEnv.trim() !== "") return fromEnv.trim();
  return readVarFromEnvFile(resolve(repoRoot(), ".env.local"), name);
}

/**
 * Resolves the active (CURRENT) signing key, caching the result. Fail-closed in production: a
 * missing key throws. In dev/test a missing key falls back to the labelled insecure key with a
 * one-time warning.
 */
function currentSigningKey(): string {
  if (keyOverride) return keyOverride.current;
  if (cachedCurrentKey !== null) return cachedCurrentKey;

  const configured = resolveConfiguredKey(CURRENT_KEY_ENV_VAR);
  if (configured) {
    cachedCurrentKey = configured;
    return cachedCurrentKey;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      `${CURRENT_KEY_ENV_VAR} is required in production but is not set; refusing to sign sessions with an insecure key.`,
    );
  }

  if (!warnedAboutInsecureKey) {
    // Never print the key itself; just flag that an insecure fallback is in effect.
    // eslint-disable-next-line no-console
    console.warn(
      `[session-signing] ${CURRENT_KEY_ENV_VAR} is not set; using an INSECURE dev fallback key. Do NOT use this in production.`,
    );
    warnedAboutInsecureKey = true;
  }

  cachedCurrentKey = INSECURE_DEV_KEY;
  return cachedCurrentKey;
}

/**
 * Resolves the PREVIOUS signing key (the one a just-rotated deployment still accepts), caching the
 * result. Null when SESSION_SIGNING_KEY_PREVIOUS is unset/empty — i.e. no rotation window is open.
 */
function previousSigningKey(): string | null {
  if (keyOverride) return keyOverride.previous;
  if (previousKeyResolved) return cachedPreviousKey;
  cachedPreviousKey = resolveConfiguredKey(PREVIOUS_KEY_ENV_VAR);
  previousKeyResolved = true;
  return cachedPreviousKey;
}

/**
 * The ordered set of keys a signature is verified against: CURRENT first, then PREVIOUS when a
 * rotation window is open. A caller-supplied key (a test seam) short-circuits both.
 */
function verificationKeys(explicitKey: string | undefined): readonly string[] {
  if (explicitKey !== undefined) return [explicitKey];
  const current = currentSigningKey();
  const previous = previousSigningKey();
  return previous !== null && previous !== current ? [current, previous] : [current];
}

/**
 * Test seam: pin the CURRENT/PREVIOUS keys (or pass null to restore env-driven resolution). Lets a
 * test simulate "the key was rotated" — sign with the old key, then verify it is still accepted as
 * PREVIOUS and rejected once PREVIOUS is cleared — without mutating process.env or leaking a key.
 */
export function __setSessionSigningKeysForTests(
  keys: { readonly current: string; readonly previous: string | null } | null,
): void {
  keyOverride = keys;
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
  /** Override the signing key. Primarily a test seam for wrong-key/previous-key rejection. */
  readonly key?: string;
}

/**
 * Signs the already-base64url-encoded payload bytes into a full session cookie value. New cookies
 * are ALWAYS signed with the CURRENT key (unless a test seam overrides it via `opts.key`).
 * Callers pass `base64url(JSON.stringify(payload))`; this appends the issued/expiry timestamps and
 * the HMAC signature.
 */
export function signSessionCookieValue(payloadB64Url: string, opts: SignOptions = {}): string {
  const key = opts.key ?? currentSigningKey();
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

/** The verified, still-live contents of a signed session token. */
export interface VerifiedSessionToken {
  /** The embedded base64url payload segment (callers decode this to the JSON payload). */
  readonly payloadB64Url: string;
  /** Issue time (ms epoch) the token was signed at — the trustworthy source for an idle check. */
  readonly issuedAt: number;
  /** Absolute expiry (ms epoch). */
  readonly expiresAt: number;
}

/**
 * Verifies a session cookie value and returns its embedded payload segment plus the signed
 * issued/expiry timestamps, or null (never throws) for any missing/tampered/expired/wrong-key/
 * malformed value. The signature is accepted when it matches the CURRENT key OR the PREVIOUS key
 * (rotation); a signature under any other key is rejected. The expiry is enforced after the
 * signature so a valid-signature-but-past-TTL token is still rejected.
 */
export function verifySignedSessionToken(
  value: string | undefined | null,
  opts: VerifyOptions = {},
): VerifiedSessionToken | null {
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

  const signingInput = `${payloadB64Url}.${issuedAtRaw}.${expiresAtRaw}`;
  // Accept a signature made with any currently-honoured key (CURRENT, then PREVIOUS). Every
  // candidate is compared in constant time; we never short-circuit on the first mismatch.
  let signatureOk = false;
  for (const key of verificationKeys(opts.key)) {
    if (constantTimeEquals(signature, computeSignature(signingInput, key))) {
      signatureOk = true;
    }
  }
  if (!signatureOk) return null;

  const issuedAt = Number(issuedAtRaw);
  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)) return null;
  const now = opts.now ?? Date.now();
  if (now >= expiresAt) return null;

  return { payloadB64Url, issuedAt, expiresAt };
}

/**
 * Back-compatible convenience over verifySignedSessionToken: returns just the embedded base64url
 * payload segment on success, or null for any failure. Unchanged public contract from
 * SIGNED_SESSION_COOKIE_V1 — every existing caller keeps working.
 */
export function verifySessionCookieValue(
  value: string | undefined | null,
  opts: VerifyOptions = {},
): string | null {
  return verifySignedSessionToken(value, opts)?.payloadB64Url ?? null;
}
