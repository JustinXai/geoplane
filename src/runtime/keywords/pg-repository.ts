import type { DatabasePort, Queryable } from "../../persistence/database-port.js";
import type {
  HumanReviewPackage,
  KeywordFamilyDraft,
  KeywordRawObservation,
  KeywordReferenceSnapshot,
  KeywordReferenceSourceImport,
  KeywordReviewRecord,
  KeywordScope,
} from "./contracts.js";
import type { PreparedKeywordImport } from "./normalization.js";
import type { KeywordRuntimeRepository } from "./ports.js";

export class PgKeywordRuntimeRepository implements KeywordRuntimeRepository {
  constructor(private readonly db: DatabasePort) {}

  async savePreparedImport(value: PreparedKeywordImport): Promise<"CREATED" | "ALREADY_IMPORTED"> {
    const existing = await this.findCompletedImportByManifest(value.sourceImport, value.sourceImport.sourceManifestHash);
    if (existing) return "ALREADY_IMPORTED";
    await this.db.transaction(async (tx) => {
      await insertImport(tx, value.sourceImport);
      for (const raw of value.rawObservations) await insertRaw(tx, raw);
      for (const form of value.normalizedForms) {
        await tx.query(
          `INSERT INTO keyword_normalized_form
             (id, client_organization_id, project_id, raw_observation_id, normalized_keyword, normalization_rule_version, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [form.id, form.clientOrganizationId, form.projectId, form.rawObservationId, form.normalizedKeyword, form.normalizationRuleVersion, form.createdAt],
        );
      }
      for (const discovery of value.discoveries) {
        await tx.query(
          `INSERT INTO keyword_discovery
             (id, client_organization_id, project_id, normalized_form_id, seed_keyword, discovery_method, discovered_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [discovery.id, discovery.clientOrganizationId, discovery.projectId, discovery.normalizedFormId, discovery.seedKeyword, discovery.method, discovery.discoveredAt],
        );
      }
      for (const demand of value.demandObservations) {
        await tx.query(
          `INSERT INTO keyword_demand_observation
             (id, client_organization_id, project_id, normalized_form_id, raw_observation_id, evidence_status, metric_kind, metric_value, observed_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [demand.id, demand.clientOrganizationId, demand.projectId, demand.normalizedFormId, demand.rawObservationId, demand.status, demand.metricKind, demand.metricValue, demand.observedAt],
        );
      }
      await insertSnapshot(tx, value.snapshot);
    });
    return "CREATED";
  }

  async addImport(value: KeywordReferenceSourceImport): Promise<void> { await insertImport(this.db, value); }
  async findCompletedImportByManifest(scope: KeywordScope, hash: string): Promise<KeywordReferenceSourceImport | undefined> {
    const result = await this.db.query<ImportRow>(
      `SELECT * FROM keyword_reference_source_import
       WHERE client_organization_id=$1 AND project_id=$2 AND source_manifest_hash=$3 AND status='COMPLETED'`,
      [scope.clientOrganizationId, scope.projectId, hash],
    );
    return result.rows[0] ? mapImport(result.rows[0]) : undefined;
  }
  async addRawObservations(values: readonly KeywordRawObservation[]): Promise<void> {
    await this.db.transaction(async (tx) => { for (const value of values) await insertRaw(tx, value); });
  }
  async addSnapshot(value: KeywordReferenceSnapshot): Promise<void> { await insertSnapshot(this.db, value); }
  async getSnapshot(scope: KeywordScope,id:string):Promise<KeywordReferenceSnapshot|undefined>{
    const result=await this.db.query<SnapshotRow>(`SELECT * FROM keyword_reference_snapshot WHERE id=$1 AND client_organization_id=$2 AND project_id=$3`,[id,scope.clientOrganizationId,scope.projectId]);
    const row=result.rows[0];
    return row?{id:row.id,clientOrganizationId:row.client_organization_id,projectId:row.project_id,importId:row.import_id,snapshotVersion:row.snapshot_version,manifestHash:row.manifest_hash,rawObservationCount:row.raw_observation_count,normalizedFormCount:row.normalized_form_count,demandObservationCount:row.demand_observation_count,sealedAt:row.sealed_at.toISOString()}:undefined;
  }
  async listNormalizedFormIdsForSnapshot(scope:KeywordScope,snapshotId:string):Promise<readonly string[]>{
    const result=await this.db.query<{id:string}>(`SELECT n.id FROM keyword_normalized_form n JOIN keyword_raw_observation r ON r.id=n.raw_observation_id JOIN keyword_reference_snapshot s ON s.import_id=r.import_id WHERE s.id=$1 AND n.client_organization_id=$2 AND n.project_id=$3 ORDER BY n.id`,[snapshotId,scope.clientOrganizationId,scope.projectId]);
    return result.rows.map(row=>row.id);
  }

  async addFamilyDraft(value: KeywordFamilyDraft): Promise<void> {
    if (value.normalizedFormIds.length === 0) throw new Error("FAMILY_DRAFT_REQUIRES_MEMBER");
    await this.db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO keyword_family_draft
          (id,client_organization_id,project_id,snapshot_id,version,label,rationale,status,created_by_user_id,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [value.id,value.clientOrganizationId,value.projectId,value.snapshotId,value.version,value.label,value.rationale,value.status,value.createdByUserId,value.createdAt],
      );
      for (let position=0; position<value.normalizedFormIds.length; position+=1) {
        await tx.query(`INSERT INTO keyword_family_draft_member (client_organization_id,project_id,family_draft_id,normalized_form_id,position) VALUES ($1,$2,$3,$4,$5)`, [value.clientOrganizationId,value.projectId,value.id,value.normalizedFormIds[position]!,position]);
      }
    });
  }
  async getFamilyDraft(scope: KeywordScope, id: string): Promise<KeywordFamilyDraft | undefined> {
    const result = await this.db.query<FamilyRow>(`SELECT * FROM keyword_family_draft WHERE id=$1 AND client_organization_id=$2 AND project_id=$3`, [id,scope.clientOrganizationId,scope.projectId]);
    const row=result.rows[0]; if (!row) return undefined;
    const members=await this.db.query<{normalized_form_id:string}>(`SELECT normalized_form_id FROM keyword_family_draft_member WHERE family_draft_id=$1 ORDER BY position`,[id]);
    return {id:row.id,clientOrganizationId:row.client_organization_id,projectId:row.project_id,snapshotId:row.snapshot_id,version:row.version,label:row.label,rationale:row.rationale,status:row.status,createdByUserId:row.created_by_user_id,createdAt:row.created_at.toISOString(),normalizedFormIds:members.rows.map(x=>x.normalized_form_id)};
  }
  async addReviewPackage(value: HumanReviewPackage): Promise<void> {
    if (value.familyDraftIds.length === 0) throw new Error("REVIEW_PACKAGE_REQUIRES_ITEM");
    await this.db.transaction(async tx=>{
      await tx.query(`INSERT INTO keyword_human_review_package (id,client_organization_id,project_id,snapshot_id,package_version,status,submitted_by_user_id,submitted_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,[value.id,value.clientOrganizationId,value.projectId,value.snapshotId,value.packageVersion,value.status,value.submittedByUserId,value.submittedAt]);
      for(let position=0;position<value.familyDraftIds.length;position+=1) await tx.query(`INSERT INTO keyword_human_review_package_item (client_organization_id,project_id,review_package_id,family_draft_id,position) VALUES ($1,$2,$3,$4,$5)`,[value.clientOrganizationId,value.projectId,value.id,value.familyDraftIds[position]!,position]);
    });
  }
  async getReviewPackage(scope: KeywordScope,id:string):Promise<HumanReviewPackage|undefined>{
    const result=await this.db.query<PackageRow>(`SELECT * FROM keyword_human_review_package WHERE id=$1 AND client_organization_id=$2 AND project_id=$3`,[id,scope.clientOrganizationId,scope.projectId]); const row=result.rows[0]; if(!row)return undefined;
    const items=await this.db.query<{family_draft_id:string}>(`SELECT family_draft_id FROM keyword_human_review_package_item WHERE review_package_id=$1 ORDER BY position`,[id]);
    return {id:row.id,clientOrganizationId:row.client_organization_id,projectId:row.project_id,snapshotId:row.snapshot_id,packageVersion:row.package_version,status:row.status,submittedByUserId:row.submitted_by_user_id,submittedAt:row.submitted_at.toISOString(),familyDraftIds:items.rows.map(x=>x.family_draft_id)};
  }
  async addReviewRecord(value:KeywordReviewRecord):Promise<void>{await this.db.query(`INSERT INTO keyword_human_review_record (id,client_organization_id,project_id,review_package_id,family_draft_id,decision,reviewer_user_id,decided_at,note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[value.id,value.clientOrganizationId,value.projectId,value.reviewPackageId,value.familyDraftId,value.decision,value.reviewerUserId,value.decidedAt,value.note??null]);}
  async listReviewRecords(scope:KeywordScope,packageId:string):Promise<KeywordReviewRecord[]>{
    const result=await this.db.query<ReviewRow>(`SELECT * FROM keyword_human_review_record WHERE review_package_id=$1 AND client_organization_id=$2 AND project_id=$3 ORDER BY decided_at,id`,[packageId,scope.clientOrganizationId,scope.projectId]);
    return result.rows.map(row=>({id:row.id,clientOrganizationId:row.client_organization_id,projectId:row.project_id,reviewPackageId:row.review_package_id,familyDraftId:row.family_draft_id,decision:row.decision,reviewerUserId:row.reviewer_user_id,decidedAt:row.decided_at.toISOString(),...(row.note?{note:row.note}:{})}));
  }
}

interface ImportRow {id:string;client_organization_id:string;project_id:string;source_kind:"BAIDU_REFERENCE_EXPORT";source_format:"CSV"|"XLSX";source_file_name:string;source_manifest_hash:string;status:"PENDING"|"VALIDATED"|"COMPLETED"|"FAILED";started_at:Date;completed_at:Date|null;parsed_count:number;rejected_count:number}
interface FamilyRow{id:string;client_organization_id:string;project_id:string;snapshot_id:string;version:number;label:string;rationale:string;status:"DRAFT"|"SUBMITTED";created_by_user_id:string;created_at:Date}
interface PackageRow{id:string;client_organization_id:string;project_id:string;snapshot_id:string;package_version:number;status:"OPEN"|"IN_REVIEW"|"COMPLETED";submitted_by_user_id:string;submitted_at:Date}
interface ReviewRow{id:string;client_organization_id:string;project_id:string;review_package_id:string;family_draft_id:string;decision:"CONFIRMED"|"CHANGES_REQUESTED"|"REJECTED";reviewer_user_id:string;decided_at:Date;note:string|null}
interface SnapshotRow{id:string;client_organization_id:string;project_id:string;import_id:string;snapshot_version:number;manifest_hash:string;raw_observation_count:number;normalized_form_count:number;demand_observation_count:number;sealed_at:Date}
function mapImport(row:ImportRow):KeywordReferenceSourceImport{return{id:row.id,clientOrganizationId:row.client_organization_id,projectId:row.project_id,sourceKind:row.source_kind,format:row.source_format,sourceFileName:row.source_file_name,sourceManifestHash:row.source_manifest_hash,status:row.status,startedAt:row.started_at.toISOString(),...(row.completed_at?{completedAt:row.completed_at.toISOString()}:{}),parsedCount:row.parsed_count,rejectedCount:row.rejected_count};}
async function insertImport(db:Queryable,v:KeywordReferenceSourceImport){await db.query(`INSERT INTO keyword_reference_source_import (id,client_organization_id,project_id,source_kind,source_format,source_file_name,source_manifest_hash,status,started_at,completed_at,parsed_count,rejected_count) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[v.id,v.clientOrganizationId,v.projectId,v.sourceKind,v.format,v.sourceFileName,v.sourceManifestHash,v.status,v.startedAt,v.completedAt??null,v.parsedCount,v.rejectedCount]);}
async function insertRaw(db:Queryable,v:KeywordRawObservation){await db.query(`INSERT INTO keyword_raw_observation (id,client_organization_id,project_id,import_id,source_locator,seed_keyword,raw_keyword,demand_value,observed_at,raw_record_hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[v.id,v.clientOrganizationId,v.projectId,v.importId,v.sourceLocator,v.seedKeyword,v.rawKeyword,v.demandValue??null,v.observedAt,v.rawRecordHash]);}
async function insertSnapshot(db:Queryable,v:KeywordReferenceSnapshot){await db.query(`INSERT INTO keyword_reference_snapshot (id,client_organization_id,project_id,import_id,snapshot_version,manifest_hash,raw_observation_count,normalized_form_count,demand_observation_count,sealed_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[v.id,v.clientOrganizationId,v.projectId,v.importId,v.snapshotVersion,v.manifestHash,v.rawObservationCount,v.normalizedFormCount,v.demandObservationCount,v.sealedAt]);}
