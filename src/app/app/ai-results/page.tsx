import { ClientProbeWorkspace } from "../../../components/client-runtime/ClientProbeWorkspace.js";

export default function ManualAiResultsPage() {
  return <><header className="cp-page-header"><div><p className="eyebrow">客户工作台</p><h1>国内 AI 检测</h1><span>从已确认的用户问题中选择，并登记国内 AI 平台的人工检测结果。</span></div></header><ClientProbeWorkspace /></>;
}
