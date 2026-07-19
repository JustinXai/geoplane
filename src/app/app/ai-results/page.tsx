import { UnavailableState } from "../../../components/client-runtime/UnavailableState.js";
import { CHINA_AI_PROBE_REGISTRY } from "../../../runtime/probes/registry.js";

export default function ManualAiResultsPage() {
  return <><header className="cp-page-header"><div><p className="eyebrow">客户工作台</p><h1>AI 查询结果</h1><span>查看国内 AI 平台的人工查询记录和审核结果。</span></div></header>
    <p>当前启用平台：{CHINA_AI_PROBE_REGISTRY.filter((item) => item.status === "ACTIVE").map((item) => item.displayName).join("、")}</p>
    <UnavailableState title="查询结果列表尚未开放">后端目前支持人工登记查询样本，但未提供客户侧结果读取接口。本页不会用演示记录代替真实结果。</UnavailableState>
    <p className="cp-callout">本阶段不支持自动登录、批量执行或自动调用外部平台。</p>
  </>;
}
