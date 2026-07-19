import type { KeywordSource } from "../../lib/api-client/generic-keywords/contracts.js";

export const keywordSourceText: Record<KeywordSource, string> = {
  MANUAL: "手动添加",
  GENERIC_FILE: "通用文件",
  BAIDU_KEYWORD: "百度关键词兼容导入",
  CUSTOMER_HISTORY: "客户历史数据",
  OTHER_PROVIDER: "其他真实来源",
};

export function provided(value: string | number | null | undefined): string {
  return value === undefined || value === null || value === "" ? "未提供" : String(value);
}
