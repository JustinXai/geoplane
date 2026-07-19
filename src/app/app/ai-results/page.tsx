import { ClientProbeWorkspace } from "../../../components/client-runtime/ClientProbeWorkspace.js";

export default function ManualAiResultsPage() {
  return <><header className="cp-page-header"><div><p className="eyebrow">客户工作台</p><h1>国内 AI 检测</h1><span>登记并查看豆包、通义千问、DeepSeek 和腾讯元宝的人工检测记录。</span></div></header><ClientProbeWorkspace /></>;
}
