/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC (net-new runtime-phase file)
 * reconstruction_source: ../ingestion/parsers.ts (D2's detectKnowledgeFormat, whose
 *   contentType-first / extension-fallback rules this reliable layer preserves and extends
 *   with an explicit MIME-vs-extension cross-check), GEO_BUSINESS_CHAIN_V1 chain step 1.
 * reconstruction_reason: KNOWLEDGE_INGESTION_RELIABILITY_V1 - format detection is the first
 *   reliability gate. It maps (contentType, filename) to one of the five in-scope formats,
 *   rejects out-of-scope inputs (spreadsheets, images/OCR, unknown) as UNSUPPORTED_FILE_TYPE,
 *   and cross-checks the declared MIME against the filename extension so a mislabeled upload
 *   surfaces a warning instead of silently mis-parsing.
 * original_file_unavailable: n/a (net-new runtime-phase file)
 *
 * Pure module: no I/O, no library imports.
 */
import { err, ok, type KnowledgeResult } from "./errors.js";

/** The five in-scope extracted-content formats. Mirrors the D2 parser's format set. */
export type KnowledgeFormat = "TXT" | "MARKDOWN" | "DOCX" | "PDF" | "URL";

/** A resolved format plus any non-fatal detection warnings (e.g. a MIME/extension mismatch). */
export interface FormatDetection {
  readonly format: KnowledgeFormat;
  readonly warnings: readonly string[];
}

const OOXML_DOCX =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const OOXML_XLSX =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Stable warning prefix emitted when the declared MIME and the filename extension disagree. */
export const MIME_EXTENSION_MISMATCH_WARNING = "MIME_EXTENSION_MISMATCH";

/** Lower-cased MIME essence (the part before any ";charset=" etc.). */
export function mimeEssence(contentType: string): string {
  const semi = contentType.indexOf(";");
  const head = semi === -1 ? contentType : contentType.slice(0, semi);
  return head.trim().toLowerCase();
}

/** Lower-cased file extension WITHOUT the dot, or "" when there is none. */
export function extensionOf(filename: string | undefined): string {
  if (!filename) return "";
  const dot = filename.lastIndexOf(".");
  if (dot === -1 || dot === filename.length - 1) return "";
  return filename.slice(dot + 1).toLowerCase();
}

/** Out-of-scope classification for a MIME/extension pair, or null when possibly in scope. */
function outOfScopeReason(mime: string, ext: string): string | null {
  if (
    mime === OOXML_XLSX ||
    mime === "application/vnd.ms-excel" ||
    mime === "text/csv" ||
    ext === "xlsx" ||
    ext === "xls" ||
    ext === "csv"
  ) {
    return `Spreadsheet input (mime="${mime}", ext="${ext}") is out of scope for knowledge ingestion`;
  }
  if (
    mime.startsWith("image/") ||
    ["png", "jpg", "jpeg", "gif", "tiff", "bmp", "webp"].includes(ext)
  ) {
    return `Image input (mime="${mime}", ext="${ext}") requires OCR, which is out of scope`;
  }
  return null;
}

/** Map a single MIME essence to an in-scope format, or null when it is not a recognised in-scope MIME. */
function formatFromMime(mime: string): KnowledgeFormat | null {
  if (mime === OOXML_DOCX) return "DOCX";
  if (mime === "application/pdf") return "PDF";
  if (mime === "text/html" || mime === "application/xhtml+xml") return "URL";
  if (mime === "text/markdown" || mime === "text/x-markdown") return "MARKDOWN";
  if (mime === "text/plain") return "TXT";
  return null;
}

/** Map a single file extension to an in-scope format, or null when it is not a recognised in-scope extension. */
function formatFromExtension(ext: string): KnowledgeFormat | null {
  if (ext === "docx") return "DOCX";
  if (ext === "pdf") return "PDF";
  if (ext === "html" || ext === "htm") return "URL";
  if (ext === "md" || ext === "markdown") return "MARKDOWN";
  if (ext === "txt" || ext === "text") return "TXT";
  return null;
}

/**
 * Resolve the format for an upload. contentType wins (it is what the extractor will trust); the
 * filename extension is a fallback AND a cross-check. Returns UNSUPPORTED_FILE_TYPE for
 * spreadsheets, images (OCR out of scope) and anything unrecognised.
 *
 * When BOTH the MIME and the extension resolve to an in-scope format but DISAGREE, the MIME
 * wins and a MIME_EXTENSION_MISMATCH warning is attached (a mislabeled upload is surfaced, not
 * silently mis-parsed, and never blocks a bulk upload).
 */
export function detectFormat(
  contentType: string,
  filename: string | undefined,
): KnowledgeResult<FormatDetection> {
  const mime = mimeEssence(contentType);
  const ext = extensionOf(filename);

  const scopeReason = outOfScopeReason(mime, ext);
  if (scopeReason !== null) {
    return err("UNSUPPORTED_FILE_TYPE", scopeReason);
  }

  const byMime = formatFromMime(mime);
  const byExt = formatFromExtension(ext);

  if (byMime === null && byExt === null) {
    return err(
      "UNSUPPORTED_FILE_TYPE",
      `Unrecognised knowledge input (mime="${mime}", ext="${ext}")`,
    );
  }

  // contentType wins; extension is the fallback. Cross-check only when both are recognised.
  const format = byMime ?? byExt;
  if (format === null) {
    // Unreachable: at least one of byMime/byExt is non-null here, but the guard keeps the
    // return type honest under noUncheckedIndexedAccess/strict null checks.
    return err("UNSUPPORTED_FILE_TYPE", `Unrecognised knowledge input (mime="${mime}", ext="${ext}")`);
  }

  const warnings: string[] = [];
  if (byMime !== null && byExt !== null && byMime !== byExt) {
    warnings.push(
      `${MIME_EXTENSION_MISMATCH_WARNING}: declared content-type "${mime}" (${byMime}) ` +
        `does not match filename extension ".${ext}" (${byExt}); using content-type`,
    );
  }

  return ok({ format, warnings });
}
