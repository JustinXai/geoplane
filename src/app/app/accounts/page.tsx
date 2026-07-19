import { UnavailableState } from "../../../components/client-runtime/UnavailableState.js";

export default function ClientAccountAuthorizationPage() {
  return <><header className="cp-page-header"><div><p className="eyebrow">客户工作台</p><h1>账号授权</h1><span>管理客户自有的国内平台账号授权。</span></div></header>
    <UnavailableState title="账号授权列表尚未开放">后端目前只有受控登记与授权命令，没有客户侧账号列表和撤销接口。为避免泄露账号归属或产生无法撤销的操作，本页暂不提供按钮。</UnavailableState>
    <p className="cp-callout">本系统不会在页面展示或保存明文密码、登录凭据或访问密钥。</p>
  </>;
}
