/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC (net-new runtime-phase file)
 * reconstruction_source: docs/architecture/GEO_BUSINESS_CHAIN_V1.md (chain step 1,
 *   "Knowledge package / enterprise knowledge base ingestion"), the existing D2 parser
 *   ../ingestion/parsers.ts (which this reliable layer supersedes and hardens), migrations/0002.
 * reconstruction_reason: KNOWLEDGE_INGESTION_RELIABILITY_V1 checkpoint - a *reliable* parser
 *   layer needs one closed, typed vocabulary of failure modes so callers can branch on a code
 *   instead of matching thrown strings. Every failure a file/URL ingest can hit maps to exactly
 *   one KnowledgeErrorCode; parsing/downloading return a discriminated Result, never a throw.
 * original_file_unavailable: n/a (net-new runtime-phase file)
 *
 * This module is pure: no I/O, no library imports, no secrets.
 */

/**
 * The closed taxonomy of ingestion failure modes. Every reliable-layer failure - file OR URL -
 * classifies to exactly one of these. Kept as a string-literal union (not a TS `enum`) so it is
 * erasable under `isolatedModules` and safe to import from tests as a type.
 */
export type KnowledgeErrorCode =
  /** MIME/extension resolves to a format we deliberately do not ingest (xlsx, images, ...). OCR is out of scope. */
  | "UNSUPPORTED_FILE_TYPE"
  /** Source bytes exceed MAX_KNOWLEDGE_FILE_BYTES before any parsing is attempted. */
  | "FILE_TOO_LARGE"
  /** The bytes claimed a supported format but the extractor could not decode them (corrupt/truncated). */
  | "PARSE_FAILED"
  /** Parsing succeeded but produced no usable text (whitespace-only / blank document). */
  | "EMPTY_CONTENT"
  /** The document is password-protected / encrypted; we do not prompt for or guess passwords. */
  | "ENCRYPTED_DOCUMENT"
  /** A URL fetch exceeded the configured timeout budget. */
  | "URL_TIMEOUT"
  /** A URL responded with a non-HTML content-type (we only ingest HTML pages as URL documents). */
  | "URL_NOT_HTML"
  /** A URL fetch failed outright (network error, or a non-2xx HTTP status). */
  | "DOWNLOAD_FAILED";

/** Every member of the taxonomy, for exhaustiveness assertions and tests. */
export const KNOWLEDGE_ERROR_CODES = [
  "UNSUPPORTED_FILE_TYPE",
  "FILE_TOO_LARGE",
  "PARSE_FAILED",
  "EMPTY_CONTENT",
  "ENCRYPTED_DOCUMENT",
  "URL_TIMEOUT",
  "URL_NOT_HTML",
  "DOWNLOAD_FAILED",
] as const satisfies readonly KnowledgeErrorCode[];

/** A classified, non-thrown failure. `cause` retains the underlying error for logging/debugging. */
export interface KnowledgeError {
  readonly code: KnowledgeErrorCode;
  /** Human-readable, safe to log. Never contains document text or secrets. */
  readonly message: string;
  /** The original error/value that triggered this classification, if any. Never surfaced to clients. */
  readonly cause?: unknown;
}

/**
 * A discriminated result. The reliable layer returns this instead of throwing so that every
 * caller is forced (by the type) to handle the failure branch. `ok` is the discriminant.
 */
export type KnowledgeResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: KnowledgeError };

/** Construct a success result. */
export function ok<T>(value: T): KnowledgeResult<T> {
  return { ok: true, value };
}

/** Construct a failure result from a code (+ optional message/cause). */
export function err<T = never>(
  code: KnowledgeErrorCode,
  message: string,
  cause?: unknown,
): KnowledgeResult<T> {
  return { ok: false, error: { code, message, cause } };
}
