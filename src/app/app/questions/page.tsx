import { ClientQuestionWorkspace } from "../../../components/client-runtime/ClientQuestionWorkspace.js";

export default function UserQuestionConfirmationPage() {
  return <><header className="cp-page-header"><div><p className="eyebrow">客户工作台</p><h1>用户问题确认</h1><span>查看真实入库的问题，并逐条保存人工确认或移除决定。</span></div></header><ClientQuestionWorkspace /></>;
}
