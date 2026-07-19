import type { Queryable } from "../../persistence/database-port.js";
import type { KnowledgeBusinessContext, KnowledgeGroundingSnapshot } from "./contracts.js";
import type { KnowledgeGroundingPort } from "./ports.js";

interface PackageRow {
  id: string;
  client_organization_id: string;
  project_id: string;
  geo_version: string;
}

interface ProfileRow {
  legal_name: string;
  display_name: string | null;
  industry: string | null;
  description: string | null;
  forbidden_usage: string | null;
}

interface ContentRow {
  title: string;
  content_text: string;
}

const SECTION_ALIASES: Readonly<Record<keyof Omit<KnowledgeBusinessContext, "enterpriseIntroduction" | "faqs" | "industry">, readonly string[]>> = {
  productsAndServices: ["产品与服务", "产品服务", "主营产品", "服务"],
  cases: ["案例", "客户案例", "成功案例"],
  targetAudiences: ["目标人群", "目标客户", "受众"],
  regions: ["地域", "服务区域", "目标区域"],
  businessGoals: ["业务目标", "项目目标", "目标"],
  differentiators: ["差异化能力", "核心优势", "差异化"],
  forbiddenExpressions: ["禁止表达", "禁用表达", "禁止用语"],
  verifiableFacts: ["可验证事实", "事实依据", "企业事实"],
};

function compact(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\r/g, "");
}

function splitValues(value: string): string[] {
  return value
    .split(/[\n,，;；、]+/)
    .map((item) => item.replace(/^[-*•\d.)（()\s]+/, "").trim())
    .filter(Boolean);
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function sectionValues(text: string, aliases: readonly string[]): string[] {
  const headings = Object.values(SECTION_ALIASES).flat();
  const escapedStop = headings.map((item) => item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  for (const alias of aliases) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = text.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*[:：]\\s*([\\s\\S]*?)(?=\\n\\s*(?:${escapedStop})\\s*[:：]|$)`, "i"));
    if (match?.[1]) return splitValues(match[1]);
  }
  return [];
}

function parseFaqs(texts: readonly string[]): KnowledgeBusinessContext["faqs"] {
  const faqs: { question: string; answer?: string }[] = [];
  for (const text of texts) {
    const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
    for (let index = 0; index < lines.length; index += 1) {
      const question = lines[index]?.match(/^(?:Q|问题|问)\s*[:：]\s*(.+)$/i)?.[1]?.trim();
      if (!question) continue;
      const answer = lines[index + 1]?.match(/^(?:A|回答|答)\s*[:：]\s*(.+)$/i)?.[1]?.trim();
      faqs.push(answer ? { question, answer } : { question });
    }
  }
  return faqs;
}

function buildContext(profile: ProfileRow | undefined, contents: readonly ContentRow[]): KnowledgeBusinessContext {
  const texts = contents.map((row) => compact(row.content_text)).filter(Boolean);
  const combined = texts.join("\n");
  const introduction =
    compact(profile?.description) ||
    sectionValues(combined, ["企业介绍", "公司介绍", "品牌介绍"])[0] ||
    texts[0]?.slice(0, 1000) ||
    "";
  const values = <K extends keyof typeof SECTION_ALIASES>(key: K): string[] =>
    unique(texts.flatMap((text) => sectionValues(text, SECTION_ALIASES[key])));
  return {
    enterpriseIntroduction: introduction,
    productsAndServices: values("productsAndServices"),
    cases: values("cases"),
    faqs: parseFaqs(texts),
    targetAudiences: values("targetAudiences"),
    regions: values("regions"),
    businessGoals: values("businessGoals"),
    differentiators: values("differentiators"),
    forbiddenExpressions: unique([
      ...values("forbiddenExpressions"),
      ...splitValues(compact(profile?.forbidden_usage)),
    ]),
    verifiableFacts: values("verifiableFacts"),
    ...(compact(profile?.industry) ? { industry: compact(profile?.industry) } : {}),
  };
}

export class PgKnowledgeGroundingPort implements KnowledgeGroundingPort {
  constructor(private readonly db: Queryable) {}

  async findLatestPackageId(scope: {
    readonly clientOrganizationId: string;
    readonly projectId: string;
  }): Promise<string | null> {
    const result = await this.db.query<{ id: string }>(
      `SELECT id FROM knowledge_package
       WHERE client_organization_id=$1 AND project_id=$2
       ORDER BY (status='CONFIRMED') DESC, updated_at DESC, created_at DESC, id
       LIMIT 1`,
      [scope.clientOrganizationId, scope.projectId],
    );
    return result.rows[0]?.id ?? null;
  }

  async load(scope: {
    readonly clientOrganizationId: string;
    readonly projectId: string;
    readonly knowledgePackageId: string;
  }): Promise<KnowledgeGroundingSnapshot | null> {
    const packages = await this.db.query<PackageRow>(
      `WITH ranked AS (
         SELECT kp.id,kp.client_organization_id,kp.project_id,
           ROW_NUMBER() OVER (PARTITION BY kp.client_organization_id,kp.project_id ORDER BY kp.created_at,kp.id) AS geo_version
         FROM knowledge_package kp
       )
       SELECT * FROM ranked
       WHERE id=$1 AND client_organization_id=$2 AND project_id=$3`,
      [scope.knowledgePackageId, scope.clientOrganizationId, scope.projectId],
    );
    const pkg = packages.rows[0];
    if (!pkg) return null;

    const [profiles, contents] = await Promise.all([
      this.db.query<ProfileRow>(
        `SELECT legal_name,display_name,industry,description,forbidden_usage
         FROM enterprise_profile WHERE client_organization_id=$1 LIMIT 1`,
        [scope.clientOrganizationId],
      ),
      this.db.query<ContentRow>(
        `SELECT d.title,c.content_text
         FROM knowledge_document d
         JOIN LATERAL (
           SELECT v.storage_path FROM knowledge_version v
           WHERE v.document_id=d.id AND v.storage_path IS NOT NULL
           ORDER BY v.version_number DESC,v.created_at DESC,v.id DESC LIMIT 1
         ) latest ON TRUE
         JOIN knowledge_content c ON c.storage_path=latest.storage_path
         WHERE d.package_id=$1 AND d.client_organization_id=$2 AND d.project_id=$3
         ORDER BY d.created_at,d.id`,
        [scope.knowledgePackageId, scope.clientOrganizationId, scope.projectId],
      ),
    ]);

    return {
      clientOrganizationId: pkg.client_organization_id,
      projectId: pkg.project_id,
      knowledgePackageId: pkg.id,
      knowledgePackageVersion: Number(pkg.geo_version),
      context: buildContext(profiles.rows[0], contents.rows),
    };
  }
}
