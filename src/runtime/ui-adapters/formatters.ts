import { ACCOUNT_PLATFORM_REGISTRY } from "../accounts/platform-registry.js";
import type { AccountOperationMode, AccountOwnership } from "../accounts/entities.js";
import { CHINA_AI_PROBE_REGISTRY } from "../probes/registry.js";

export const ACCOUNT_OWNERSHIP_LABEL:Record<AccountOwnership,string>={PLATFORM_OWNED:"平台自有",AGENCY_OWNED:"代理商自有",CLIENT_OWNED:"客户授权"};
export const ACCOUNT_OPERATION_MODE_LABEL:Record<AccountOperationMode,string>={MANUAL_OPERATION:"人工操作",ASSISTED_OPERATION:"辅助操作",SCHEDULED_CONTROLLED_TASK:"受控任务"};
export function accountPlatformLabel(code:string):string{return ACCOUNT_PLATFORM_REGISTRY.find(x=>x.code===code)?.displayName??code}
export function probePlatformLabel(code:string):string{return CHINA_AI_PROBE_REGISTRY.find(x=>x.code===code)?.displayName??code}
export function formatLocalDateTime(value:string|null):string{return value?new Intl.DateTimeFormat("zh-CN",{dateStyle:"medium",timeStyle:"short",hour12:false}).format(new Date(value)):"—"}
export function formatRatio(numerator:number,denominator:number):string{return denominator===0?"暂无数据":new Intl.NumberFormat("zh-CN",{style:"percent",maximumFractionDigits:1}).format(numerator/denominator)}
