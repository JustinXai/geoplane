import Link from "next/link";
import { UnavailableState } from "../../../components/client-runtime/UnavailableState.js";

export default function EnterpriseProfilePage() {
  return <><header className="cp-page-header"><div><p className="eyebrow">客户工作台</p><h1>企业资料</h1><span>维护内容生产所依据的企业信息与知识资料。</span></div></header>
    <UnavailableState title="企业资料总览尚未开放">当前后端可按知识包查看、上传和确认资料，但尚未提供当前项目的知识包列表。为防止跨项目引用，本页不会猜测知识包地址。</UnavailableState>
    <p><Link href="/app/knowledge">查看企业知识库说明</Link></p>
  </>;
}
