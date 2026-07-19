import type { DatabasePort, Queryable } from "../../persistence/database-port.js";
import type { ExpansionInputSnapshot, KeywordExpansionBatch, KeywordExpansionCandidate } from "./contract.js";
import type { ExpansionRepository } from "./offline-runtime.js";

interface CandidateRow {
  id: string; batch_id: string; keyword: string; question: string | null; candidate_reason: string;
  confidence: string | number; client_organization_id: string; project_id: string;
  generator_version: string; input_snapshot: ExpansionInputSnapshot; requested_by_user_id: string;
  created_at: Date | string; review_status: "CONFIRMED" | "DELETED" | null;
}
function candidate(row: CandidateRow): KeywordExpansionCandidate {
  return {
    id: row.id, batchId: row.batch_id, keyword: row.keyword, question: row.question,
    reason: row.candidate_reason, confidence: Number(row.confidence),
    status: row.review_status ?? "NEEDS_HUMAN_REVIEW",
    provenance: { generator: "DETERMINISTIC_OFFLINE", generatorVersion: row.generator_version,
      generatedAt: new Date(row.created_at).toISOString(), requestedByUserId: row.requested_by_user_id,
      inputSnapshot: row.input_snapshot },
  };
}
const candidateSelect = `SELECT c.id,c.batch_id,c.keyword,c.question,c.reason AS candidate_reason,c.confidence,
 b.client_organization_id,b.project_id,b.generator_version,b.input_snapshot,b.requested_by_user_id,b.created_at,
 e.status AS review_status FROM keyword_expansion_candidate c JOIN keyword_expansion_batch b ON b.id=c.batch_id
 LEFT JOIN keyword_expansion_review_event e ON e.candidate_id=c.id`;

export class PgExpansionRepository implements ExpansionRepository {
  constructor(private readonly db: DatabasePort) {}
  async appendBatch(batch: KeywordExpansionBatch): Promise<KeywordExpansionBatch> {
    await this.db.transaction(async (tx) => {
      const p = batch.candidates[0]?.provenance;
      if (!p) throw new Error("expansion preview has no candidates");
      await tx.query(`INSERT INTO keyword_expansion_batch
       (id,client_organization_id,project_id,version,generator,generator_version,input_snapshot,reason,requested_by_user_id,created_at)
       VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10)`,
       [batch.id,batch.clientOrganizationId,batch.projectId,batch.version,p.generator,p.generatorVersion,
        JSON.stringify(p.inputSnapshot),p.inputSnapshot.reason,p.requestedByUserId,batch.createdAt]);
      for (const c of batch.candidates) await tx.query(`INSERT INTO keyword_expansion_candidate
       (id,batch_id,keyword,question,reason,confidence) VALUES($1,$2,$3,$4,$5,$6)`,
       [c.id,c.batchId,c.keyword,c.question,c.reason,c.confidence]);
    });
    return batch;
  }
  async findCandidate(id: string) {
    const result = await this.db.query<CandidateRow>(`${candidateSelect} WHERE c.id=$1`, [id]);
    return result.rows[0] ? candidate(result.rows[0]) : undefined;
  }
  async appendReview(id: string, status: "CONFIRMED" | "DELETED", actor: string, reason: string, at: string) {
    if (!reason.trim()) throw new Error("review reason is required");
    const existing = await this.findCandidate(id);
    if (!existing) throw new Error("candidate not found");
    if (existing.status !== "NEEDS_HUMAN_REVIEW") throw new Error("candidate already reviewed");
    await this.db.query(`INSERT INTO keyword_expansion_review_event(candidate_id,status,actor_user_id,reason,created_at)
      VALUES($1,$2,$3,$4,$5)`, [id,status,actor,reason.trim(),at]);
    const found = await this.findCandidate(id);
    if (!found) throw new Error("candidate not found");
    return found;
  }
}

export async function findExpansionScope(db: Queryable, candidateId: string): Promise<{clientOrganizationId:string;projectId:string}|undefined> {
  const result = await db.query<{client_organization_id:string;project_id:string}>(
    `SELECT b.client_organization_id,b.project_id FROM keyword_expansion_candidate c
     JOIN keyword_expansion_batch b ON b.id=c.batch_id WHERE c.id=$1`, [candidateId]);
  const row=result.rows[0];
  return row ? {clientOrganizationId:row.client_organization_id,projectId:row.project_id}:undefined;
}
