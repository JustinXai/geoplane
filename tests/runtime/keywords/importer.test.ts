import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseKeywordImport } from "../../../src/runtime/keywords/importer.js";
import { sanitizedXlsxFixture } from "./xlsx-fixture.js";

const here = dirname(fileURLToPath(import.meta.url));

describe("keyword CSV/XLSX importer", () => {
  it("parses a sanitized CSV, hashes source bytes and rejects malformed rows deterministically", async () => {
    const bytes = await readFile(join(here, "fixtures", "sanitized-keywords.csv"));
    const result = parseKeywordImport("sanitized-keywords.csv", bytes);
    expect(result.format).toBe("CSV");
    expect(result.sourceHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[1]).toMatchObject({ seedKeyword: "内容运营", keyword: "GEO, 内容策略", demandValue: 85 });
    expect(result.rejected).toEqual([
      { sourceRow: 4, code: "MISSING_SEED" },
      { sourceRow: 5, code: "INVALID_DEMAND" },
    ]);
  });

  it("parses a sanitized XLSX and retains the same word under multiple seeds", () => {
    const result = parseKeywordImport("sanitized-keywords.xlsx", sanitizedXlsxFixture());
    expect(result.rows.map(({ seedKeyword, keyword }) => ({ seedKeyword, keyword }))).toEqual([
      { seedKeyword: "企业增长", keyword: "GEO 优化" },
      { seedKeyword: "内容运营", keyword: "GEO 优化" },
    ]);
    expect(result.rejected).toEqual([]);
  });

  it("rejects unsupported formats and absent required headers", () => {
    expect(() => parseKeywordImport("asset.json", new Uint8Array())).toThrow("UNSUPPORTED_KEYWORD_IMPORT_FORMAT");
    expect(() => parseKeywordImport("bad.csv", Buffer.from("keyword\n词"))).toThrow("MISSING_REQUIRED_HEADER:seed_keyword");
  });
});
