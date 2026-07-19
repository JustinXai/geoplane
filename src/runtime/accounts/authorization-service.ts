import { canAccessClientOrganization } from "../../contracts/tenancy/authorization.js";
import type { AuthorizationContext } from "../../contracts/tenancy/entities.js";
import type { AccountAssignment, AccountAuthorization, PlatformAccount } from "./entities.js";
import type { AccountRepository } from "./ports.js";
import { getAccountPlatform } from "./platform-registry.js";

export interface AccountAuditEntry {
  readonly action: string;
  readonly outcome: "ALLOWED" | "DENIED";
  readonly actorUserId: string;
  readonly actorOrganizationId: string;
  readonly clientOrganizationId: string | null;
  readonly projectId: string | null;
  readonly targetType: string;
  readonly targetId: string | null;
  readonly metadata?: Record<string, unknown>;
}

export interface AccountAuditWriter { append(entry: AccountAuditEntry): Promise<void>; }

export class AccountAuthorizationError extends Error {
  constructor(message = "Account operation is not authorized.") {
    super(message);
    this.name = "AccountAuthorizationError";
  }
}
export interface RegisterAccountInput {
  readonly platformCode: string;
  readonly accountType: PlatformAccount["accountType"];
  readonly ownership: PlatformAccount["ownership"];
  readonly agencyOrganizationId?: string | null;
  readonly clientOrganizationId?: string | null;
  readonly displayLabel: string;
  readonly secretReference?: string | null;
}

export interface AuthorizeAccountInput {
  readonly accountId: string;
  readonly clientOrganizationId?: string | null;
  readonly agencyOrganizationId?: string | null;
}

export interface AssignAccountInput {
  readonly accountId: string;
  readonly projectId: string;
  readonly clientOrganizationId: string;
  readonly operatorUserId: string;
}

function isPlatform(ctx: AuthorizationContext): boolean {
  return ctx.isPlatformAdmin || ctx.actorRole === "PLATFORM_SUPER_ADMIN";
}

function isAgency(ctx: AuthorizationContext): boolean {
  return ctx.actorRole === "AGENCY_OWNER" || ctx.actorRole === "AGENCY_OPERATOR";
}

function auditBase(ctx: AuthorizationContext, action: string, targetType: string) {
  return {
    action, actorUserId: ctx.actorUserId, actorOrganizationId: ctx.organizationId, targetType,
  } as const;
}

export class AccountAuthorizationService {
  constructor(private readonly repo: AccountRepository, private readonly audit: AccountAuditWriter) {}

  private async deny(ctx: AuthorizationContext, action: string, clientId: string | null, projectId: string | null, targetId: string | null): Promise<never> {
    await this.audit.append({ ...auditBase(ctx, action, "platform_account"), outcome: "DENIED", clientOrganizationId: clientId, projectId, targetId });
    throw new AccountAuthorizationError();
  }

  async register(ctx: AuthorizationContext, input: RegisterAccountInput): Promise<PlatformAccount> {
    const clientId = input.clientOrganizationId ?? null;
    const agencyId = input.agencyOrganizationId ?? null;
    const allowed = input.ownership === "PLATFORM_OWNED"
      ? isPlatform(ctx) && !clientId && !agencyId
      : input.ownership === "CLIENT_OWNED"
        ? !!clientId && !agencyId && canAccessClientOrganization(ctx, clientId)
        : !!agencyId && !clientId && (isPlatform(ctx) || (isAgency(ctx) && ctx.organizationId === agencyId));
    if (!allowed) return this.deny(ctx, "account.register", clientId, null, null);
    if (!input.platformCode.trim() || !input.displayLabel.trim()) throw new Error("platformCode and displayLabel are required");
    const platform = getAccountPlatform(input.platformCode);
    if (!platform || platform.accountType !== input.accountType) {
      throw new Error("platformCode is not registered for the selected accountType");
    }

    const account = await this.repo.createAccount({
      platformCode: platform.code, accountType: input.accountType,
      ownership: input.ownership, agencyOrganizationId: agencyId, clientOrganizationId: clientId,
      displayLabel: input.displayLabel.trim(), secretReference: input.secretReference?.trim() || null,
      credentialStatus: input.secretReference ? "UNVERIFIED" : "NOT_CONFIGURED", lastVerifiedAt: null,
      status: "ACTIVE", operationMode: "MANUAL_OPERATION", createdByUserId: ctx.actorUserId,
    });
    await this.audit.append({ ...auditBase(ctx, "account.register", "platform_account"), outcome: "ALLOWED", clientOrganizationId: clientId, projectId: null, targetId: account.id, metadata: { ownership: account.ownership, platformCode: account.platformCode } });
    return account;
  }

  async authorize(ctx: AuthorizationContext, input: AuthorizeAccountInput): Promise<AccountAuthorization> {
    const account = await this.repo.findAccountById(input.accountId);
    if (!account) throw new Error("Account not found");
    const clientId = input.clientOrganizationId ?? account.clientOrganizationId;
    const agencyId = input.agencyOrganizationId ?? account.agencyOrganizationId;
    const scopeMatches = account.ownership === "PLATFORM_OWNED"
      ? clientId === null && agencyId === null && isPlatform(ctx)
      : account.ownership === "CLIENT_OWNED"
        ? clientId === account.clientOrganizationId && agencyId === null && !!clientId && canAccessClientOrganization(ctx, clientId)
        : agencyId === account.agencyOrganizationId && clientId === null && !!agencyId && (isPlatform(ctx) || (isAgency(ctx) && ctx.organizationId === agencyId));
    if (!scopeMatches) return this.deny(ctx, "account.authorize", clientId, null, account.id);
    if (await this.repo.findActiveAuthorization(account.id)) throw new Error("Account is already authorized");
    const now = new Date().toISOString();
    const authorization = await this.repo.addAuthorization({ accountId: account.id, clientOrganizationId: clientId, agencyOrganizationId: agencyId, status: "AUTHORIZED", authorizedByUserId: ctx.actorUserId, authorizedAt: now, revokedByUserId: null, revokedAt: null });
    await this.audit.append({ ...auditBase(ctx, "account.authorize", "account_authorization"), outcome: "ALLOWED", clientOrganizationId: clientId, projectId: null, targetId: authorization.id });
    return authorization;
  }

  async assign(ctx: AuthorizationContext, input: AssignAccountInput): Promise<AccountAssignment> {
    const account = await this.repo.findAccountById(input.accountId);
    if (!account) throw new Error("Account not found");
    const canReachClient = canAccessClientOrganization(ctx, input.clientOrganizationId);
    const ownerMatches = account.ownership !== "CLIENT_OWNED" || account.clientOrganizationId === input.clientOrganizationId;
    const agencyMatches = account.ownership !== "AGENCY_OWNED" || isPlatform(ctx) || (isAgency(ctx) && account.agencyOrganizationId === ctx.organizationId);
    if (!canReachClient || !ownerMatches || !agencyMatches) return this.deny(ctx, "account.assign", input.clientOrganizationId, input.projectId, account.id);
    if (!await this.repo.findActiveAuthorization(account.id)) throw new Error("Account must be authorized before assignment");
    if (await this.repo.findActiveAssignment(account.id, input.projectId)) throw new Error("Account is already assigned to this project");
    const assignment = await this.repo.addAssignment({ accountId: account.id, projectId: input.projectId, clientOrganizationId: input.clientOrganizationId, operatorUserId: input.operatorUserId, status: "ACTIVE", assignedByUserId: ctx.actorUserId });
    await this.audit.append({ ...auditBase(ctx, "account.assign", "account_assignment"), outcome: "ALLOWED", clientOrganizationId: input.clientOrganizationId, projectId: input.projectId, targetId: assignment.id, metadata: { accountId: account.id, operatorUserId: input.operatorUserId } });
    return assignment;
  }
}
