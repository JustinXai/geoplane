/** Current reconstruction; classification remains RECOVERED_SPECIFIED_NOT_COMPLETED. */
import { createHash } from "node:crypto";
import type {
  ExpansionGroupInput, ExpansionGroupType, KeywordExpansionBatch,
  KeywordExpansionCandidate, KeywordExpansionRequest,
} from "./contract.js";
import { EXPANSION_GROUP_TYPES } from "./contract.js";
import { buildExpansionCombinations } from "./combination.js";

export const OFFLINE_EXPANSION_VERSION = "DETERMINISTIC_OFFLINE_V1";

export interface ExpansionRepository {
  appendBatch(batch: KeywordExpansionBatch): Promise<KeywordExpansionBatch>;
  findCandidate(id: string): Promise<KeywordExpansionCandidate | undefined>;
  appendReview(candidateId: string, status: "CONFIRMED" | "DELETED", actorUserId: string, reason: string, at: string): Promise<KeywordExpansionCandidate>;
}

function normalizeGroups(groups: readonly ExpansionGroupInput[]): ExpansionGroupInput[] {
  if (!Array.isArray(groups) || groups.length === 0 || groups.length > EXPANSION_GROUP_TYPES.length) throw new Error("expansion groups are invalid");
  const allowed = new Set<ExpansionGroupType>(EXPANSION_GROUP_TYPES);
  const seen = new Set<ExpansionGroupType>();
  return groups.map((group) => {
    const type = (group as { type?: unknown } | null)?.type;
    const rawValues: unknown = (group as { values?: unknown } | null)?.values;
    if (typeof type !== "string" || !allowed.has(type as ExpansionGroupType) || !Array.isArray(rawValues) || rawValues.length > 50 || rawValues.some((value) => typeof value !== "string")) throw new Error("expansion group is invalid");
    const safeType = type as ExpansionGroupType;
    if (seen.has(safeType)) throw new Error(`duplicate expansion group: ${safeType}`);
    seen.add(safeType);
    const values = [...new Set(rawValues.map((value) => (value as string).trim()).filter(Boolean))].sort();
    return { type: safeType, values };
  }).filter((group) => group.values.length > 0);
}

function stableId(prefix: string, value: string): string {
  const hex = createHash("sha256").update(value).digest("hex").slice(0, 24);
  return `${prefix}_${hex}`;
}

export class DeterministicOfflineExpansionAdapter {
  preview(request: KeywordExpansionRequest, generatedAt: string): KeywordExpansionBatch {
    const groups = normalizeGroups(request.groups);
    const main = groups.find((group) => group.type === "MAIN");
    if (!main?.values.length) throw new Error("MAIN group requires at least one value");
    if (!request.reason.trim()) throw new Error("generation reason is required");
    const snapshot = { groups, reason: request.reason.trim() };
    // The same business input may legitimately be submitted again after review. Include the
    // invocation identity while retaining deterministic output for a fixed request and clock.
    const fingerprint = JSON.stringify({ projectId: request.projectId, requestedByUserId: request.requestedByUserId,
      generatedAt, snapshot, version: OFFLINE_EXPANSION_VERSION });
    const batchId = stableId("exp", fingerprint);
    const provenance = {
      generator: "DETERMINISTIC_OFFLINE" as const, generatorVersion: OFFLINE_EXPANSION_VERSION,
      generatedAt, requestedByUserId: request.requestedByUserId, inputSnapshot: snapshot,
    };
    const combinations = buildExpansionCombinations(groups);
    if (combinations.length > 500) throw new Error("expansion preview exceeds 500 records");
    const candidates = combinations.map(({ keyword, question }, index): KeywordExpansionCandidate => {
      return {
        id: stableId("kw", `${batchId}:${index}:${keyword}:${question ?? ""}`), batchId, keyword, question,
        reason: request.reason.trim(), confidence: 1, status: "NEEDS_HUMAN_REVIEW", provenance,
      };
    });
    return {
      id: batchId, clientOrganizationId: request.clientOrganizationId, projectId: request.projectId,
      version: 1, status: "PREVIEW", candidates, createdAt: generatedAt,
    };
  }
}

export class KeywordExpansionService {
  constructor(
    private readonly repository: ExpansionRepository,
    private readonly adapter = new DeterministicOfflineExpansionAdapter(),
    private readonly now: () => Date = () => new Date(),
  ) {}
  async preview(request: KeywordExpansionRequest): Promise<KeywordExpansionBatch> {
    return this.repository.appendBatch(this.adapter.preview(request, this.now().toISOString()));
  }
  confirm(candidateId: string, actorUserId: string, reason: string) {
    return this.repository.appendReview(candidateId, "CONFIRMED", actorUserId, reason, this.now().toISOString());
  }
  delete(candidateId: string, actorUserId: string, reason: string) {
    return this.repository.appendReview(candidateId, "DELETED", actorUserId, reason, this.now().toISOString());
  }
}

export class MemoryExpansionRepository implements ExpansionRepository {
  private readonly candidates = new Map<string, KeywordExpansionCandidate>();
  async appendBatch(batch: KeywordExpansionBatch) {
    for (const candidate of batch.candidates) this.candidates.set(candidate.id, candidate);
    return batch;
  }
  async findCandidate(id: string) { return this.candidates.get(id); }
  async appendReview(id: string, status: "CONFIRMED" | "DELETED", _actor: string, reason: string) {
    const existing = this.candidates.get(id);
    if (!existing) throw new Error("candidate not found");
    if (existing.status !== "NEEDS_HUMAN_REVIEW") throw new Error("candidate already reviewed");
    if (!reason.trim()) throw new Error("review reason is required");
    const next = { ...existing, status };
    this.candidates.set(id, next);
    return next;
  }
}
