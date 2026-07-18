/**
 * Ambient declaration for the `pdf-parse` inner entrypoint (the package ships no types and
 * we must import `pdf-parse/lib/pdf-parse.js` directly — the package root runs debug code
 * under ESM and crashes). Scoped to this lane; does not touch tsconfig or package.json.
 */
declare module "pdf-parse/lib/pdf-parse.js" {
  interface PdfParseResult {
    text: string;
    numpages: number;
    numrender: number;
    info: unknown;
    metadata: unknown;
    version: string;
  }
  type PdfParseOptions = { max?: number; version?: string };
  export default function pdfParse(
    dataBuffer: Buffer,
    options?: PdfParseOptions,
  ): Promise<PdfParseResult>;
}
