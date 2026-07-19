export const zhCN = {
  status: {
    PENDING: "待处理",
    IN_PROGRESS: "进行中",
    NEEDS_HUMAN_REVIEW: "待人工确认",
    CONFIRMED: "已确认",
    CHANGES_REQUESTED: "需要修改",
    DEFERRED: "暂不处理",
    APPROVED: "已批准",
    REJECTED: "未通过",
    READY: "已就绪",
    DELIVERED: "已交付",
    FAILED: "执行失败",
    ACTIVE: "正常",
    REVOKED: "已撤销",
    EXPIRED: "已失效",
    SUSPENDED: "已暂停",
    COMPLETED: "已完成",
    VALIDATED: "已校验",
    NOT_STARTED: "未开始",
    WAITING_CLIENT: "等待客户确认",
    BLOCKED: "存在阻塞",
    AUTHORIZED: "已授权",
    UNVERIFIED: "待验证",
    NOT_CONFIGURED: "待配置",
  },
  ownership: {
    PLATFORM_OWNED: "平台自有",
    AGENCY_OWNED: "代理商自有",
    CLIENT_OWNED: "客户授权",
  },
  operationMode: {
    MANUAL_OPERATION: "人工操作",
    ASSISTED_OPERATION: "辅助操作",
    SCHEDULED_CONTROLLED_TASK: "受控任务",
  },
} as const;

const statusDictionary: Record<string, string> = zhCN.status;
export function statusText(value: string | null | undefined): string {
  if (!value) return "—";
  return statusDictionary[value] ?? "状态待确认";
}

export function ownershipText(value: string): string {
  return (zhCN.ownership as Record<string, string>)[value] ?? "归属待确认";
}

export function operationModeText(value: string): string {
  return (zhCN.operationMode as Record<string, string>)[value] ?? "操作方式待确认";
}

export const capabilityGapText = "该功能尚未开放";
