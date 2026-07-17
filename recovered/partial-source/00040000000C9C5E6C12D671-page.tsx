import { OrganizationCreateForm, ProjectCreateForm } from "@/components/control-plane/account-lifecycle-forms";
import { tenancyRepository } from "@/auth/server-authorization";
export default async function NewClientPage(){const clients=(await tenancyRepository.listOrganizations()).filter(x=>x.type==="CLIENT");return <><header className="cp-page-header"><div><p>组织</p><h1>创建客户与项目</h1><span>客户组织和项目分别创建并保留审计记录。</span></div></header><div className="lifecycle-grid"><OrganizationCreateForm type="CLIENT"/><ProjectCreateForm clients={clients}/></div></>}
