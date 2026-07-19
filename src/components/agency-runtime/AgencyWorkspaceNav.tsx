import Link from "next/link";

const LINKS = [
  ["代理商总览", "/agency"],
  ["授权客户", "/agency/clients"],
  ["客户项目", "/agency/projects"],
  ["待办中心", "/agency/todos"],
  ["账号中心", "/agency/accounts"],
  ["企业知识库", "/agency/knowledge"],
  ["百度关键词", "/agency/baidu-keywords"],
  ["AI 拓词", "/agency/ai-expansion"],
  ["用户问题", "/agency/keyword-questions"],
  ["内容生产", "/agency/content"],
  ["内容审核", "/agency/review-queue"],
  ["人工探测", "/agency/manual-probe"],
  ["交付管理", "/agency/deliveries"],
  ["客户报告", "/agency/reports"],
  ["团队与权限", "/agency/team"],
] as const;

export function AgencyWorkspaceNav() {
  return (
    <nav className="cp-workspace-nav" aria-label="代理商工作台导航">
      <ul>{LINKS.map(([label, href]) => <li key={href}><Link href={href}>{label}</Link></li>)}</ul>
    </nav>
  );
}
