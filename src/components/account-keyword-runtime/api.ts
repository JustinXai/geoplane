import type {
  AccountAssignment,
  AccountAuthorization,
  AccountOwnership,
  AccountType,
  PlatformAccount,
} from "../../runtime/accounts/entities.js";
import type {
  ExpansionGroupInput,
  KeywordExpansionBatch,
  KeywordExpansionCandidate,
} from "../../runtime/keyword-expansion/contract.js";
import { defaultApiClient, type ApiClient, type Result } from "../../lib/api-client/http.js";

type SafePlatformAccount = Omit<PlatformAccount, "secretReference">;

export interface RegisterAccountInput {
  readonly platformCode: string;
  readonly displayLabel: string;
  readonly accountType: AccountType;
  readonly ownership: AccountOwnership;
  readonly agencyOrganizationId?: string;
  readonly clientOrganizationId?: string;
  readonly secretReference?: string;
}

export interface AssignAccountInput {
  readonly accountId: string;
  readonly projectId: string;
  readonly clientOrganizationId: string;
  readonly operatorUserId: string;
}

export interface KeywordImportResult {
  readonly status: string;
  readonly importId: string;
  readonly snapshotId: string;
  readonly parsedCount: number;
  readonly rejectedCount: number;
  readonly duplicateRecordCount: number;
}

export const accountKeywordApi = {
  registerAccount(input: RegisterAccountInput, client: ApiClient = defaultApiClient): Promise<Result<SafePlatformAccount>> {
    return client.request("/api/accounts", { method: "POST", body: { action: "REGISTER", ...input } });
  },
  authorizeAccount(accountId: string, scope: { clientOrganizationId?: string; agencyOrganizationId?: string }, client: ApiClient = defaultApiClient): Promise<Result<AccountAuthorization>> {
    return client.request("/api/accounts", { method: "POST", body: { action: "AUTHORIZE", accountId, ...scope } });
  },
  assignAccount(input: AssignAccountInput, client: ApiClient = defaultApiClient): Promise<Result<AccountAssignment>> {
    return client.request("/api/accounts", { method: "POST", body: { action: "ASSIGN", ...input } });
  },
  importBaiduKeywords(input: { projectId: string; fileName: string; base64: string; snapshotVersion: number }, client: ApiClient = defaultApiClient): Promise<Result<KeywordImportResult>> {
    return client.request("/api/keywords/imports", { method: "POST", body: input });
  },
  previewExpansion(input: { projectId: string; reason: string; groups: readonly ExpansionGroupInput[] }, client: ApiClient = defaultApiClient): Promise<Result<KeywordExpansionBatch>> {
    return client.request("/api/keyword-expansion/preview", { method: "POST", body: input });
  },
  confirmExpansion(candidateId: string, reason: string, client: ApiClient = defaultApiClient): Promise<Result<KeywordExpansionCandidate>> {
    return client.request(`/api/keyword-expansion/candidates/${encodeURIComponent(candidateId)}/confirm`, { method: "POST", body: { reason } });
  },
  removeExpansion(candidateId: string, reason: string, client: ApiClient = defaultApiClient): Promise<Result<KeywordExpansionCandidate>> {
    return client.request(`/api/keyword-expansion/candidates/${encodeURIComponent(candidateId)}/delete`, { method: "POST", body: { reason } });
  },
};

export async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunkSize = 32_768;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}
