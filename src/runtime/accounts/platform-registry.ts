import type { AccountType } from "./entities.js";

export interface AccountPlatformDefinition {
  readonly code: string;
  readonly displayName: string;
  readonly accountType: AccountType;
}

export const ACCOUNT_PLATFORM_REGISTRY: readonly AccountPlatformDefinition[] = Object.freeze([
  { code: "DOUBAO", displayName: "豆包", accountType: "AI_PLATFORM_ACCOUNT" },
  { code: "QWEN", displayName: "通义千问", accountType: "AI_PLATFORM_ACCOUNT" },
  { code: "DEEPSEEK", displayName: "DeepSeek", accountType: "AI_PLATFORM_ACCOUNT" },
  { code: "YUANBAO", displayName: "腾讯元宝", accountType: "AI_PLATFORM_ACCOUNT" },
  { code: "BAIJIAHAO", displayName: "百家号", accountType: "CONTENT_PLATFORM_ACCOUNT" },
  { code: "TOUTIAO", displayName: "头条号", accountType: "CONTENT_PLATFORM_ACCOUNT" },
  { code: "WECHAT_OFFICIAL", displayName: "微信公众号", accountType: "CONTENT_PLATFORM_ACCOUNT" },
  { code: "ZHIHU", displayName: "知乎", accountType: "CONTENT_PLATFORM_ACCOUNT" },
  { code: "XIAOHONGSHU", displayName: "小红书", accountType: "CONTENT_PLATFORM_ACCOUNT" },
  { code: "SOHU", displayName: "搜狐号", accountType: "CONTENT_PLATFORM_ACCOUNT" },
  { code: "NETEASE", displayName: "网易号", accountType: "CONTENT_PLATFORM_ACCOUNT" },
  { code: "PENGUIN", displayName: "企鹅号", accountType: "CONTENT_PLATFORM_ACCOUNT" },
  { code: "DOUYIN", displayName: "抖音", accountType: "CONTENT_PLATFORM_ACCOUNT" },
  { code: "BILIBILI", displayName: "B站", accountType: "CONTENT_PLATFORM_ACCOUNT" },
  { code: "CSDN", displayName: "CSDN", accountType: "CONTENT_PLATFORM_ACCOUNT" },
  { code: "JIANSHU", displayName: "简书", accountType: "CONTENT_PLATFORM_ACCOUNT" },
]);

export function getAccountPlatform(code: string): AccountPlatformDefinition | undefined {
  const normalized = code.trim().toUpperCase();
  return ACCOUNT_PLATFORM_REGISTRY.find((platform) => platform.code === normalized);
}
