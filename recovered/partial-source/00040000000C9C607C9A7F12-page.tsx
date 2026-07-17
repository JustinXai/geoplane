import { AssignmentForm } from "@/components/control-plane/account-lifecycle-forms";
import { tenancyRepository } from "@/auth/server-authorization";
export default async function AssignmentsPage(){const organizations=await tenancyRepository.listOrganizations();return <><header className="cp-page-header"><div><p>客户范围</p><h1>代理商客户分配</h1><span>只有有效分配中的客户可被代理商选择。</span></div></header><AssignmentForm organizations={organizations}/></>}
