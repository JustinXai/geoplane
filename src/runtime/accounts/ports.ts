import type {
  AccountAssignment,
  AccountAuthorization,
  AccountHealth,
  AccountOperationResult,
  AccountOperationTask,
  AccountUsageRecord,
  PlatformAccount,
} from "./entities.js";

export interface AccountRepository {
  createAccount(input: Omit<PlatformAccount, "id" | "createdAt" | "updatedAt">): Promise<PlatformAccount>;
  findAccountById(id: string): Promise<PlatformAccount | null>;
  addAuthorization(input: Omit<AccountAuthorization, "id" | "createdAt">): Promise<AccountAuthorization>;
  findActiveAuthorization(accountId: string): Promise<AccountAuthorization | null>;
  revokeAuthorization(id: string, revokedByUserId: string, revokedAt: string): Promise<AccountAuthorization>;
  addAssignment(input: Omit<AccountAssignment, "id" | "assignedAt" | "revokedAt">): Promise<AccountAssignment>;
  findActiveAssignment(accountId: string, projectId: string): Promise<AccountAssignment | null>;
  addHealth(input: Omit<AccountHealth, "id">): Promise<AccountHealth>;
  addUsage(input: Omit<AccountUsageRecord, "id">): Promise<AccountUsageRecord>;
  createOperationTask(input: Omit<AccountOperationTask, "id" | "requestedAt" | "startedAt" | "completedAt">): Promise<AccountOperationTask>;
  completeOperationTask(taskId: string, status: "SUCCEEDED" | "FAILED", completedAt: string): Promise<AccountOperationTask>;
  findOperationTaskById(id: string): Promise<AccountOperationTask | null>;
  addOperationResult(input: Omit<AccountOperationResult, "id" | "recordedAt">): Promise<AccountOperationResult>;
}
