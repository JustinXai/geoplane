/**
 * SAFE_REVIEW_REFERENCE_V1 (Agent C2) — the client-safe, OPAQUE handle for an opportunity review.
 *
 * The client review command keys a decision on an internal `opportunity_validation` id, but the
 * client read surface (OpportunityViewV1) must NEVER carry that raw UUID (SYSTEM_INVARIANTS_V1: no
 * Chunk/Embedding/Artifact/validation internal id on a client-facing view). This module bridges
 * that gap with a tamper-evident token:
 *
 *   reviewReferenceCode = `${base64url(validationId)}.${HMAC-SHA256(base64url(validationId), key)}`
 *
 * The client treats the code as opaque (never displays or parses it) and passes it back verbatim to
 * the review command. The server VERIFIES the HMAC in constant time and, only on success, decodes it
 * back to the validation id — a hand-forged or tampered code fails verification and is rejected. The
 * raw UUID never appears in clear text on the client surface (it is base64url-wrapped AND signed).
 *
 * Key loading (never commits a secret): `REVIEW_REFERENCE_KEY_CURRENT` is read from process.env
 * first, then a dedicated fallback to `SESSION_SIGNING_KEY_CURRENT` (so a single configured signing
 * secret covers both surfaces), then a gitignored `.env.local` at the repo root for either name —
 * same precedence style as session-signing.ts / persistence/config.ts. In production a missing key
 * fails closed (throws when first needed); in dev/test it falls back to a clearly-labelled INSECURE
 * key with a one-time warning so local flows still work. Verification uses the same key, so an
 * encoded code round-trips within a process; only tampered/forged/wrong-key codes are rejected.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEDICATED_KEY_ENV_VAR = "REVIEW_REFERENCE_KEY_CURRENT";
const SHARED_KEY_ENV_VAR = "SESSION_SIGNING_KEY_CURRENT";

/**
 * The dev/test fallback used ONLY when no real key is configured and NODE_ENV is not production.
 * Intentionally obvious and worthless: it must never be relied on for real security.
 */
const INSECURE_DEV_KEY =
  "geoplane-INSECURE-dev-review-reference-key-DO-NOT-USE-IN-PRODUCTION";

// ---------------------------------------------------------------------------
// Key resolution (process.env, then .env.local; fail-closed in production)
// ---------------------------------------------------------------------------

let cachedKey: string | null = null;
let warnedAboutInsecureKey = false;

/** Repo root = three levels up from src/runtime/geo. */
function repoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
}

/** Minimal KEY=VALUE reader for a single var (mirrors session-signing.ts; no interpolation). */
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
  for (const name of [DEDICATED_KEY_ENV_VAR, SHARED_KEY_ENV_VAR]) {
    const fromEnv = process.env[name];
    if (fromEnv && fromEnv.trim() !== "") return fromEnv.trim();
  }
  const envFile = resolve(repoRoot(), ".env.local");
  for (const name of [DEDICATED_KEY_ENV_VAR, SHARED_KEY_ENV_VAR]) {
    const fromFile = readVarFromEnvFile(envFile, name);
    if (fromFile) return fromFile;
  }
  return null;
}

/**
 * Resolves the active review-reference key, caching the result. Fail-closed in production: a missing
 * key throws. In dev/test a missing key falls back to the labelled insecure key with a one-time warning.
 */
function loadKey(): string {
  if (cachedKey !== null) return cachedKey;

  const configured = resolveConfiguredKey();
  if (configured) {
    cachedKey = configured;
    return cachedKey;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      `${DEDICATED_KEY_ENV_VAR} (or ${SHARED_KEY_ENV_VAR}) is required in production but is not set; refusing to sign review references with an insecure key.`,
    );
  }

  if (!warnedAboutInsecureKey) {
    // Never print the key itself; just flag that an insecure fallback is in effect.
    // eslint-disable-next-line no-console
    console.warn(
      `[review-reference] no ${DEDICATED_KEY_ENV_VAR}/${SHARED_KEY_ENV_VAR} set; using an INSECURE dev fallback key. Do NOT use this in production.`,
    );
    warnedAboutInsecureKey = true;
  }

  cachedKey = INSECURE_DEV_KEY;
  return cachedKey;
}

// ---------------------------------------------------------------------------
// Encode / decode
// ---------------------------------------------------------------------------

const SEGMENT_COUNT = 2;

function sign(payloadB64Url: string): string {
  return createHmac("sha256", loadKey()).update(payloadB64Url, "utf8").digest("base64url");
}

/** Length-checked constant-time comparison (timingSafeEqual requires equal-length buffers). */
function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Encodes an internal opportunity_validation id into the opaque, tamper-evident reviewReferenceCode
 * the client carries. The raw id is base64url-wrapped (never clear text) then HMAC-signed.
 */
export function encodeReviewReferenceCode(validationId: string): string {
  const payload = Buffer.from(validationId, "utf8").toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/**
 * Verifies a reviewReferenceCode and decodes it back to the internal validation id, or returns null
 * (never throws) for any missing/malformed/tampered/wrong-key code. Callers MUST treat null as
 * "invalid reference" and refuse the write — never fall through to a default validation id.
 */
export function decodeReviewReferenceCode(code: string | null | undefined): string | null {
  if (!code) return null;
  const parts = code.split(".");
  if (parts.length !== SEGMENT_COUNT) return null;
  const payload = parts[0];
  const signature = parts[1];
  if (payload === undefined || signature === undefined || payload === "") return null;
  if (!constantTimeEquals(signature, sign(payload))) return null;
  try {
    const validationId = Buffer.from(payload, "base64url").toString("utf8");
    return validationId.length > 0 ? validationId : null;
  } catch {
    return null;
  }
}
