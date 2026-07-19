import { ACCOUNT_PLATFORM_REGISTRY } from "../accounts/platform-registry.js";
import type { AccountOperationMode, AccountOwnership } from "../accounts/entities.js";
import { CHINA_AI_PROBE_REGISTRY } from "../probes/registry.js";

export const ACCOUNT_OWNERSHIP_LABEL:Record<AccountOwnership,string>={PLATFORM_OWNED:"平台自有",AGENCY_OWNED:"代理商自有",CLIENT_OWNED:"客户授权"};
export const ACCOUNT_OPERATION_MODE_LABEL:Record<AccountOperationMode,string>={MANUAL_OPERATION:"人工操作",ASSISTED_OPERATION:"辅助操作",SCHEDULED_CONTROLLED_TASK:"受控任务"};
export function accountPlatformLabel(code:string):string{return ACCOUNT_PLATFORM_REGISTRY.find(x=>x.code===code)?.displayName??code}
export function probePlatformLabel(code:string):string{return CHINA_AI_PROBE_REGISTRY.find(x=>x.code===code)?.displayName??code}
export function formatLocalDateTime(value:string|null):string{return value?new Intl.DateTimeFormat("zh-CN",{dateStyle:"medium",timeStyle:"short",hour12:false}).format(new Date(value)):"—"}
export function formatRatio(numerator:number,denominator:number):string{return denominator===0?"暂无数据":new Intl.NumberFormat("zh-CN",{style:"percent",maximumFractionDigits:1}).format(numerator/denominator)}

const LOCAL_TEST_DISPLAY_NAMES: Readonly<Record<string, string>> = Object.freeze({
  "Sample Local Platform (Pilot Fixture)": "本地验收平台",
  "Sample Local Agency (Pilot Fixture)": "本地验收代理商",
  "Sample Local Client (Pilot Fixture)": "本地验收客户",
  "Sample Local Closed Pilot Project": "本地验收项目",
  "Sample Platform Operator (Pilot Fixture)": "本地验收平台",
  "Sample Content Agency (Pilot Fixture)": "本地验收代理商",
  "Sample Manufacturing Enterprise (Pilot Fixture)": "本地验收制造企业",
  "Sample Secondary Enterprise (Pilot Fixture)": "本地验收企业二",
  "Sample Client (Pilot Fixture)": "本地验收客户",
  "Sample Project (Pilot Fixture)": "本地验收项目",
});

/**
 * Presentation-only protection for sanitized local seed identities.
 *
 * The stored organization/project value remains unchanged so audit and backup evidence
 * continues to prove that no real customer data is present. Formal pages receive a stable
 * Chinese label instead of exposing engineering seed vocabulary.
 */
export function safeBusinessDisplayName(value: string, kind: "组织" | "项目" | "内容" = "组织"): string {
  const exact = LOCAL_TEST_DISPLAY_NAMES[value.trim()];
  if (exact) return exact;
  if (/\b(?:sample|fixture|mock|demo)\b|pilot\s+fixture/i.test(value)) return `本地验收${kind}`;
  return value;
}
