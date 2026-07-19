import type {
  HumanReviewPackage,
  KeywordFamilyDraft,
  KeywordRawObservation,
  KeywordReferenceSnapshot,
  KeywordReferenceSourceImport,
  KeywordReviewRecord,
  KeywordScope,
} from "./contracts.js";

/** Append-only storage contract. No update/delete operation is exposed. */
export interface KeywordRuntimeRepository {
  addImport(value: KeywordReferenceSourceImport): Promise<void>;
  findCompletedImportByManifest(scope: KeywordScope, manifestHash: string): Promise<KeywordReferenceSourceImport | undefined>;
  addRawObservations(values: readonly KeywordRawObservation[]): Promise<void>;
  addSnapshot(value: KeywordReferenceSnapshot): Promise<void>;
  addFamilyDraft(value: KeywordFamilyDraft): Promise<void>;
  getFamilyDraft(scope: KeywordScope, id: string): Promise<KeywordFamilyDraft | undefined>;
  addReviewPackage(value: HumanReviewPackage): Promise<void>;
  getReviewPackage(scope: KeywordScope, id: string): Promise<HumanReviewPackage | undefined>;
  addReviewRecord(value: KeywordReviewRecord): Promise<void>;
  listReviewRecords(scope: KeywordScope, packageId: string): Promise<KeywordReviewRecord[]>;
}
