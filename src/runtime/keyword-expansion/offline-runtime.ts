/** Current reconstruction; classification remains RECOVERED_SPECIFIED_NOT_COMPLETED. */
import { createHash } from "node:crypto";
import type {
  ExpansionGroupInput, ExpansionGroupType, KeywordExpansionBatch,
  KeywordExpansionCandidate, KeywordExpansionRequest,
} from "./contract.js";
import { buildExpansionCombinations } from "./combination.js";

export const OFFLINE_EXPANSION_VERSION = "DETERMINISTIC_OFFLINE_V1";

export interface ExpansionRepository {
  appendBatch(batch: KeywordExpansionBatch): Promise<KeywordExpansionBatch>;
  findCandidate(id: string): Promise<KeywordExpansionCandidate | undefined>;
  appendReview(candidateId: string, status: "CONFIRMED" | "DELETED", actorUserId: string, reason: string, at: string): Promise<KeywordExpansionCandidate>;
}

function normalizeGroups(groups: readonly ExpansionGroupInput[]): ExpansionGroupInput[] {
  const seen = new Set<ExpansionGroupType>();
  return groups.map((group) => {
    if (seen.has(group.type)) throw new Error(`duplicate expansion group: ${group.type}`);
    seen.add(group.type);
    const values = [...new Set(group.values.map((value) => value.trim()).filter(Boolean))].sort();
    return { type: group.type, values };
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
    const fingerprint = JSON.stringify({ projectId: request.projectId, snapshot, version: OFFLINE_EXPANSION_VERSION });
    const batchId = stableId("exp", fingerprint);
    const provenance = {
      generator: "DETERMINISTIC_OFFLINE" as const, generatorVersion: OFFLINE_EXPANSION_VERSION,
      generatedAt, requestedByUserId: request.requestedByUserId, inputSnapshot: snapshot,
    };
    const candidates = buildExpansionCombinations(groups).map(({ keyword, question }, index): KeywordExpansionCandidate => {
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
