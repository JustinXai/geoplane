/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC (net-new runtime-phase file)
 * reconstruction_source: the sibling reliable-parser modules in this directory.
 * reconstruction_reason: KNOWLEDGE_INGESTION_RELIABILITY_V1 - a single public entry point for
 *   the reliable knowledge parser layer, so Agent A can rewire the ingestion service to it with
 *   one import path.
 * original_file_unavailable: n/a (net-new runtime-phase file)
 */
export {
  KNOWLEDGE_ERROR_CODES,
  err,
  ok,
  type KnowledgeError,
  type KnowledgeErrorCode,
  type KnowledgeResult,
} from "./errors.js";
export {
  MIME_EXTENSION_MISMATCH_WARNING,
  detectFormat,
  extensionOf,
  mimeEssence,
  type FormatDetection,
  type KnowledgeFormat,
} from "./format-detection.js";
export {
  extractPdf,
  isEncryptedPdfError,
  unpdfTextExtractor,
  type PdfExtraction,
  type PdfTextExtractor,
} from "./pdf-extractor.js";
export {
  MAX_KNOWLEDGE_FILE_BYTES,
  ReliableKnowledgeParser,
  htmlToText,
  type DocxTextExtractor,
  type KnowledgeParseInput,
  type KnowledgeParseResult,
  type KnowledgeParser,
  type ReliableKnowledgeParserDeps,
} from "./knowledge-parser.js";
