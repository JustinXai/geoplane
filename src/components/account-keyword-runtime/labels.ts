import type {
  AccountHealthStatus,
  AccountOperationMode,
  AccountOwnership,
  AccountRiskStatus,
  AccountStatus,
  AuthorizationStatus,
  CredentialStatus,
  OperationTaskStatus,
} from "../../runtime/accounts/entities.js";
import type { ExpansionGroupType, ExpansionReviewStatus } from "../../runtime/keyword-expansion/contract.js";

export const accountStatusLabel: Record<AccountStatus, string> = {
  ACTIVE: "正常",
  SUSPENDED: "已停用",
  REVOKED: "已撤销",
};

export const authorizationStatusLabel: Record<AuthorizationStatus, string> = {
  PENDING: "待授权",
  AUTHORIZED: "已授权",
  REVOKED: "已撤销",
};

export const credentialStatusLabel: Record<CredentialStatus, string> = {
  NOT_CONFIGURED: "未配置",
  UNVERIFIED: "待验证",
  VERIFIED: "验证通过",
  EXPIRED: "已失效",
  REVOKED: "已撤销",
};

export const accountHealthLabel: Record<AccountHealthStatus, string> = {
  UNKNOWN: "尚未检查",
  HEALTHY: "正常",
  DEGRADED: "需要关注",
  UNAVAILABLE: "暂不可用",
};

export const accountRiskLabel: Record<AccountRiskStatus, string> = {
  UNKNOWN: "尚未评估",
  NORMAL: "正常",
  ATTENTION: "需要关注",
  BLOCKED: "已阻止",
};

export const operationModeLabel: Record<AccountOperationMode, string> = {
  MANUAL_OPERATION: "人工操作",
  ASSISTED_OPERATION: "辅助操作",
  SCHEDULED_CONTROLLED_TASK: "受控定时任务",
};

export const operationTaskStatusLabel: Record<OperationTaskStatus, string> = {
  PENDING: "待处理",
  IN_PROGRESS: "进行中",
  SUCCEEDED: "已完成",
  FAILED: "执行失败",
  CANCELLED: "已取消",
};

export const ownershipLabel: Record<AccountOwnership, string> = {
  PLATFORM_OWNED: "平台账号",
  AGENCY_OWNED: "代理商账号",
  CLIENT_OWNED: "客户账号",
};

export const expansionGroupLabel: Record<ExpansionGroupType, string> = {
  PREFIX: "前置限定",
  MAIN: "核心词",
  SUFFIX: "后置限定",
  RECOMMENDATION: "推荐意图",
  QUESTION: "问题表达",
  REGION: "地域范围",
};

export const expansionReviewStatusLabel: Record<ExpansionReviewStatus, string> = {
  NEEDS_HUMAN_REVIEW: "待人工确认",
  CONFIRMED: "已确认",
  DELETED: "已移除",
};

export function accountKeywordErrorMessage(code: string, fallback?: string): string {
  const messages: Record<string, string> = {
    UNAUTHENTICATED: "登录状态已失效，请重新登录。",
    FORBIDDEN: "当前账号没有执行此操作的权限。",
    NOT_FOUND: "所选项目或记录不存在，请刷新后重试。",
    VALIDATION_FAILED: "提交内容不完整或格式不正确，请检查后重试。",
    CONFLICT: "当前记录已被处理，请刷新后查看最新状态。",
    INTERNAL_ERROR: "系统暂时无法完成操作，请稍后重试。",
  };
  return messages[code] ?? fallback ?? "操作未完成，请稍后重试。";
}
