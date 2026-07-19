import { createHash } from "node:crypto";
import type {
  KeywordDemandObservation,
  KeywordDiscovery,
  KeywordNormalizedForm,
  KeywordParsedFile,
  KeywordRawObservation,
  KeywordReferenceSnapshot,
  KeywordReferenceSourceImport,
  KeywordScope,
} from "./contracts.js";

export const KEYWORD_NORMALIZATION_RULE_VERSION = "zh-CN-basic-v1";

export interface KeywordIdFactory { next(): string }

export interface PrepareKeywordImportInput extends KeywordScope {
  readonly sourceFileName: string;
  readonly parsed: KeywordParsedFile;
  readonly now: string;
  readonly snapshotVersion: number;
}

export interface PreparedKeywordImport {
  readonly sourceImport: KeywordReferenceSourceImport;
  readonly rawObservations: readonly KeywordRawObservation[];
  readonly normalizedForms: readonly KeywordNormalizedForm[];
  readonly discoveries: readonly KeywordDiscovery[];
  readonly demandObservations: readonly KeywordDemandObservation[];
  readonly snapshot: KeywordReferenceSnapshot;
  readonly duplicateRecordCount: number;
}

export function normalizeKeyword(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\u00a0\s]+/g, " ")
    .trim()
    .toLocaleLowerCase("zh-CN");
}

function recordHash(row: {
  readonly seedKeyword: string;
  readonly keyword: string;
  readonly demandValue?: number;
  readonly observedAt?: string;
}): string {
  return createHash("sha256").update(JSON.stringify([
    row.seedKeyword,
    row.keyword,
    row.demandValue ?? null,
    row.observedAt ?? null,
  ])).digest("hex");
}

export function prepareKeywordImport(
  input: PrepareKeywordImportInput,
  ids: KeywordIdFactory,
): PreparedKeywordImport {
  if (input.snapshotVersion < 1) throw new Error("INVALID_SNAPSHOT_VERSION");
  const importId = ids.next();
  const rawObservations: KeywordRawObservation[] = [];
  const normalizedForms: KeywordNormalizedForm[] = [];
  const discoveries: KeywordDiscovery[] = [];
  const demandObservations: KeywordDemandObservation[] = [];
  const seen = new Set<string>();
  let duplicateRecordCount = 0;

  for (const row of input.parsed.rows) {
    const rawRecordHash = recordHash(row);
    if (seen.has(rawRecordHash)) {
      duplicateRecordCount += 1;
      continue;
    }
    seen.add(rawRecordHash);
    const rawObservationId = ids.next();
    const normalizedFormId = ids.next();
    const observedAt = row.observedAt ?? input.now;
    rawObservations.push({
      id: rawObservationId,
      clientOrganizationId: input.clientOrganizationId,
      projectId: input.projectId,
      importId,
      sourceLocator: `${input.sourceFileName}#row=${row.sourceRow}`,
      seedKeyword: row.seedKeyword,
      rawKeyword: row.keyword,
      ...(row.demandValue === undefined ? {} : { demandValue: row.demandValue }),
      observedAt,
      rawRecordHash,
    });
    normalizedForms.push({
      id: normalizedFormId,
      clientOrganizationId: input.clientOrganizationId,
      projectId: input.projectId,
      rawObservationId,
      normalizedKeyword: normalizeKeyword(row.keyword),
      normalizationRuleVersion: KEYWORD_NORMALIZATION_RULE_VERSION,
      createdAt: input.now,
    });
    discoveries.push({
      id: ids.next(),
      clientOrganizationId: input.clientOrganizationId,
      projectId: input.projectId,
      normalizedFormId,
      seedKeyword: row.seedKeyword,
      method: "IMPORTED_SEED_EXPANSION",
      discoveredAt: input.now,
    });
    if (row.demandValue !== undefined) {
      demandObservations.push({
        id: ids.next(),
        clientOrganizationId: input.clientOrganizationId,
        projectId: input.projectId,
        normalizedFormId,
        rawObservationId,
        status: "OBSERVED_DEMAND",
        metricKind: "BAIDU_DEMAND_INDEX",
        metricValue: row.demandValue,
        observedAt,
      });
    }
  }

  const snapshotId = ids.next();
  return {
    sourceImport: {
      id: importId,
      clientOrganizationId: input.clientOrganizationId,
      projectId: input.projectId,
      sourceKind: "BAIDU_REFERENCE_EXPORT",
      format: input.parsed.format,
      sourceFileName: input.sourceFileName,
      sourceManifestHash: input.parsed.sourceHash,
      status: "COMPLETED",
      startedAt: input.now,
      completedAt: input.now,
      parsedCount: rawObservations.length,
      rejectedCount: input.parsed.rejected.length,
    },
    rawObservations,
    normalizedForms,
    discoveries,
    demandObservations,
    snapshot: {
      id: snapshotId,
      clientOrganizationId: input.clientOrganizationId,
      projectId: input.projectId,
      importId,
      snapshotVersion: input.snapshotVersion,
      manifestHash: input.parsed.sourceHash,
      rawObservationCount: rawObservations.length,
      normalizedFormCount: normalizedForms.length,
      demandObservationCount: demandObservations.length,
      sealedAt: input.now,
    },
    duplicateRecordCount,
  };
}
