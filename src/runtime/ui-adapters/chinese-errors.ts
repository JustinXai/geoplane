import type { ApiErrorCodeV1 } from "../api-contracts/index.js";
import { ApiClientError } from "../../lib/api-client/http.js";

const ERROR_LABELS:Record<ApiErrorCodeV1,string>={UNAUTHENTICATED:"登录状态已失效，请重新登录。",FORBIDDEN:"您没有权限执行此操作。",NOT_FOUND:"未找到对应的数据。",VALIDATION_FAILED:"提交内容不完整或格式不正确。",CONFLICT:"数据状态已变化，请刷新后重试。",INTERNAL_ERROR:"系统暂时无法处理，请稍后重试。"};
export function chineseApiError(code:ApiErrorCodeV1,serverMessage?:string):string{return ERROR_LABELS[code]??serverMessage??"系统暂时无法处理。"}
export function chineseTransportError(error:unknown):string{if(error instanceof ApiClientError)return error.kind==="NETWORK"?"网络连接失败，请检查本地服务是否已启动。":"服务返回了无法识别的数据，请稍后重试。";return "系统暂时无法处理，请稍后重试。"}

export const BACKEND_CAPABILITY_GAP="BACKEND_CAPABILITY_GAP" as const;
export interface BackendCapabilityGap {readonly code:typeof BACKEND_CAPABILITY_GAP;readonly title:string;readonly message:"该功能尚未开放"}
export function backendCapabilityGap(title:string):BackendCapabilityGap{return{code:BACKEND_CAPABILITY_GAP,title,message:"该功能尚未开放"}}
