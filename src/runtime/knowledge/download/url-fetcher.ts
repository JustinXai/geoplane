/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC (net-new runtime-phase file)
 * reconstruction_source: the frozen KNOWLEDGE_INGESTION_RELIABILITY_V1 checkpoint spec, D2's
 *   ../ingestion/parsers.ts contract (URL documents are ingested from ALREADY-fetched HTML
 *   bytes - the network I/O lives here, not in the parser), ../parsers/errors.ts taxonomy.
 * reconstruction_reason: KNOWLEDGE_INGESTION_RELIABILITY_V1 - the ONE place that performs URL
 *   network I/O for knowledge ingestion. It fetches a URL with a timeout budget, rejects
 *   non-HTML responses and failed/non-2xx downloads, and on success returns the raw bytes +
 *   content-type for the reliable parser to turn into text. fetch is injectable so tests run
 *   with a fake and never touch the real network.
 * original_file_unavailable: n/a (net-new runtime-phase file)
 *
 * This helper never parses document bytes and holds no secrets; it only moves bytes.
 */
import { err, ok, type KnowledgeResult } from "../parsers/errors.js";

/** Default per-request timeout budget (15s) for a knowledge URL fetch. */
export const DEFAULT_URL_TIMEOUT_MS = 15_000;

/** Content-types we accept as ingestible HTML pages. */
const HTML_MIME_ESSENCES = new Set(["text/html", "application/xhtml+xml"]);

/** The minimal fetch surface the helper depends on (a subset of the WHATWG `fetch`). */
export type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal },
) => Promise<FetchLikeResponse>;

/** The minimal Response surface the helper reads. */
export interface FetchLikeResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface FetchUrlDocumentInput {
  readonly url: string;
  /** Timeout budget in ms. Defaults to DEFAULT_URL_TIMEOUT_MS. */
  readonly timeoutMs?: number;
  /** Injectable fetch. Defaults to the global `fetch`. Tests pass a fake (no real network). */
  readonly fetchImpl?: FetchLike;
}

/** A successfully-downloaded URL document: raw bytes + the reported content-type + final url. */
export interface FetchedUrlDocument {
  readonly url: string;
  readonly contentType: string;
  readonly bytes: Uint8Array;
}

function mimeEssence(contentType: string): string {
  const semi = contentType.indexOf(";");
  const head = semi === -1 ? contentType : contentType.slice(0, semi);
  return head.trim().toLowerCase();
}

/**
 * Fetch a URL as an HTML knowledge document. Never throws; classifies every failure:
 *
 *   - timeout / abort         -> URL_TIMEOUT
 *   - fetch rejects           -> DOWNLOAD_FAILED
 *   - non-2xx HTTP status     -> DOWNLOAD_FAILED
 *   - non-HTML content-type   -> URL_NOT_HTML
 *
 * On success it returns bytes + contentType; it does NOT parse them - the reliable
 * KnowledgeParser turns the HTML bytes into text (format "URL").
 */
export async function fetchUrlDocument(
  input: FetchUrlDocumentInput,
): Promise<KnowledgeResult<FetchedUrlDocument>> {
  const timeoutMs = input.timeoutMs ?? DEFAULT_URL_TIMEOUT_MS;
  const doFetch: FetchLike =
    input.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  let response: FetchLikeResponse;
  try {
    response = await doFetch(input.url, { signal: controller.signal });
  } catch (cause) {
    if (timedOut || isAbortError(cause)) {
      return err(
        "URL_TIMEOUT",
        `URL fetch exceeded the ${timeoutMs}ms timeout budget: ${input.url}`,
        cause,
      );
    }
    const detail = cause instanceof Error ? cause.message : String(cause);
    return err("DOWNLOAD_FAILED", `URL fetch failed: ${detail}`, cause);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    return err(
      "DOWNLOAD_FAILED",
      `URL responded with a non-2xx status ${response.status}: ${input.url}`,
    );
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!HTML_MIME_ESSENCES.has(mimeEssence(contentType))) {
    return err(
      "URL_NOT_HTML",
      `URL content-type "${contentType || "(none)"}" is not HTML: ${input.url}`,
    );
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return err("DOWNLOAD_FAILED", `Reading URL response body failed: ${detail}`, cause);
  }

  return ok({ url: input.url, contentType, bytes });
}

/** True for a DOMException/AbortError raised when an in-flight fetch is aborted. */
function isAbortError(cause: unknown): boolean {
  return (
    typeof cause === "object" &&
    cause !== null &&
    (cause as { name?: unknown }).name === "AbortError"
  );
}
