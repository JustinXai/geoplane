/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC (net-new runtime-phase file)
 * reconstruction_source: unpdf@1.6.2 public API (getDocumentProxy + extractText, the
 *   serverless pdf.js build), the frozen KNOWLEDGE_INGESTION_RELIABILITY_V1 checkpoint spec,
 *   and D2's ../ingestion/parsers.ts PdfExtractor seam (kept as an injectable boundary).
 * reconstruction_reason: pdf-parse@1.1.4 throws "bad XRef entry" on every valid PDF under
 *   Node 22 in this environment, so the reliable layer extracts PDF text via unpdf instead.
 *   The extractor is the ONE place that touches the PDF library; it is injectable so tests can
 *   drive the classifier deterministically, while the real unpdf path is exercised by the real
 *   committed PDF fixtures. Encrypted/password-protected PDFs are classified distinctly from
 *   generic corruption, and OCR (scanned images) is never attempted.
 * original_file_unavailable: n/a (net-new runtime-phase file)
 */
import { extractText, getDocumentProxy } from "unpdf";
import { err, ok, type KnowledgeResult } from "./errors.js";

/** What a PDF extractor returns on success: merged plain text plus the page count. */
export interface PdfExtraction {
  readonly text: string;
  readonly totalPages: number;
}

/**
 * The PDF-text extraction seam. The default delegates to unpdf; tests inject fakes to drive the
 * classifier (e.g. a simulated PasswordException) without shipping encrypted binary fixtures.
 * It may throw - the caller (extractPdf) is responsible for classifying any thrown error.
 */
export type PdfTextExtractor = (bytes: Uint8Array) => Promise<PdfExtraction>;

/**
 * The real extractor: unpdf's serverless pdf.js. `getDocumentProxy` rejects with a
 * PasswordException for encrypted PDFs and an InvalidPDFException for corrupt bytes; both
 * propagate to extractPdf's classifier below.
 */
export const unpdfTextExtractor: PdfTextExtractor = async (bytes) => {
  const pdf = await getDocumentProxy(bytes);
  const { text, totalPages } = await extractText(pdf, { mergePages: true });
  return { text, totalPages };
};

/**
 * Decide whether a thrown PDF error means the document is encrypted/password-protected.
 *
 * pdf.js signals a missing/incorrect password by throwing a `PasswordException` (its `.name`
 * is exactly "PasswordException", with a numeric `.code` of 1=NEED_PASSWORD or 2=INCORRECT).
 * We key on the name first, then fall back to a message probe so simulated or wrapped errors
 * still classify correctly. Everything else (InvalidPDFException, truncation, ...) is generic
 * corruption -> PARSE_FAILED.
 */
export function isEncryptedPdfError(cause: unknown): boolean {
  if (typeof cause !== "object" || cause === null) return false;
  const record = cause as { name?: unknown; message?: unknown; code?: unknown };
  if (record.name === "PasswordException") return true;
  const message = typeof record.message === "string" ? record.message : "";
  return /password|encrypt/i.test(message);
}

/**
 * Extract text from PDF bytes and classify any failure. Never throws.
 *
 *   - encrypted / password-protected -> ENCRYPTED_DOCUMENT
 *   - any other extractor failure     -> PARSE_FAILED
 *
 * Emptiness is NOT decided here (a successful extraction of a blank page is still a success);
 * the parser applies the shared EMPTY_CONTENT rule uniformly across all formats.
 */
export async function extractPdf(
  bytes: Uint8Array,
  extractor: PdfTextExtractor = unpdfTextExtractor,
): Promise<KnowledgeResult<PdfExtraction>> {
  try {
    return ok(await extractor(bytes));
  } catch (cause) {
    if (isEncryptedPdfError(cause)) {
      return err(
        "ENCRYPTED_DOCUMENT",
        "PDF is password-protected or encrypted; ingestion does not unlock protected documents",
        cause,
      );
    }
    const detail = cause instanceof Error ? cause.message : String(cause);
    return err("PARSE_FAILED", `PDF could not be parsed: ${detail}`, cause);
  }
}
