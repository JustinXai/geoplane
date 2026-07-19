/**
 * DOMESTIC_ACCOUNT_CENTER_V1 — account-center domain contract.
 *
 * Accounts store only an opaque secret reference and credential health. Passwords, cookies,
 * tokens and API keys are deliberately absent from every input and persisted entity.
 */
export type AccountType = "AI_PLATFORM_ACCOUNT" | "CONTENT_PLATFORM_ACCOUNT";

export type AccountOwnership = "PLATFORM_OWNED" | "CLIENT_OWNED" | "AGENCY_OWNED";

export type AccountOperationMode =
  | "MANUAL_OPERATION"
  | "ASSISTED_OPERATION"
  | "SCHEDULED_CONTROLLED_TASK";

export type AccountStatus = "ACTIVE" | "SUSPENDED" | "REVOKED";
export type AuthorizationStatus = "PENDING" | "AUTHORIZED" | "REVOKED";
export type AssignmentStatus = "ACTIVE" | "REVOKED";
export type CredentialStatus = "NOT_CONFIGURED" | "UNVERIFIED" | "VERIFIED" | "EXPIRED" | "REVOKED";
export type AccountHealthStatus = "UNKNOWN" | "HEALTHY" | "DEGRADED" | "UNAVAILABLE";
export type AccountRiskStatus = "UNKNOWN" | "NORMAL" | "ATTENTION" | "BLOCKED";
export type OperationTaskStatus = "PENDING" | "IN_PROGRESS" | "SUCCEEDED" | "FAILED" | "CANCELLED";

export interface PlatformAccount {
  readonly id: string;
  readonly platformCode: string;
  readonly accountType: AccountType;
  readonly ownership: AccountOwnership;
  readonly agencyOrganizationId: string | null;
  readonly clientOrganizationId: string | null;
  readonly displayLabel: string;
  readonly secretReference: string | null;
  readonly credentialStatus: CredentialStatus;
  readonly lastVerifiedAt: string | null;
  readonly status: AccountStatus;
  readonly operationMode: AccountOperationMode;
  readonly createdByUserId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AccountAuthorization {
  readonly id: string;
  readonly accountId: string;
  readonly clientOrganizationId: string | null;
  readonly agencyOrganizationId: string | null;
  readonly status: AuthorizationStatus;
  readonly authorizedByUserId: string;
  readonly authorizedAt: string | null;
  readonly revokedByUserId: string | null;
  readonly revokedAt: string | null;
  readonly createdAt: string;
}

export interface AccountAssignment {
  readonly id: string;
  readonly accountId: string;
  readonly projectId: string;
  readonly clientOrganizationId: string;
  readonly operatorUserId: string;
  readonly status: AssignmentStatus;
  readonly assignedByUserId: string;
  readonly assignedAt: string;
  readonly revokedAt: string | null;
}

export interface AccountHealth {
  readonly id: string;
  readonly accountId: string;
  readonly healthStatus: AccountHealthStatus;
  readonly riskStatus: AccountRiskStatus;
  readonly dailyUsageCount: number;
  readonly failureCount: number;
  readonly lastException: string | null;
  readonly lastExecutedAt: string | null;
  readonly checkedAt: string;
}

export interface AccountUsageRecord {
  readonly id: string;
  readonly accountId: string;
  readonly projectId: string;
  readonly clientOrganizationId: string;
  readonly operatorUserId: string;
  readonly operationKind: string;
  readonly succeeded: boolean;
  readonly failureCategory: string | null;
  readonly occurredAt: string;
}

export interface AccountOperationTask {
  readonly id: string;
  readonly accountId: string;
  readonly assignmentId: string;
  readonly projectId: string;
  readonly clientOrganizationId: string;
  readonly operationKind: string;
  readonly operationMode: AccountOperationMode;
  readonly status: OperationTaskStatus;
  readonly requestedByUserId: string;
  readonly operatorUserId: string;
  readonly requestedAt: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
}

export interface AccountOperationResult {
  readonly id: string;
  readonly taskId: string;
  readonly accountId: string;
  readonly status: "SUCCEEDED" | "FAILED";
  readonly resultSummary: string | null;
  readonly failureCategory: string | null;
  readonly publicationReceiptId: string | null;
  readonly recordedByUserId: string;
  readonly recordedAt: string;
}
