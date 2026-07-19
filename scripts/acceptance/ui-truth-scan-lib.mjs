import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

const FIXTURE_LEAKS = [
  /Sample Local/iu,
  /Pilot Fixture/iu,
  /\bFixture\b/iu,
  /\bMock\b/iu,
  /Demo Client/iu,
  /Demo Agency/iu,
];
const OLD_AI_TERMS = [/国内\s*AI\s*查询/u, /人工探测/u, /AI\s*探测/iu];
const SECRET_KEY = /(password|secret|token|api.?key|credential.?ref|encrypted|endpoint)/iu;

function filesIn(directory, suffix) {
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(suffix))
      .map((entry) => join(directory, entry.name));
  } catch {
    return [];
  }
}

function inspectSecretKeys(value, path = "$") {
  const findings = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => findings.push(...inspectSecretKeys(item, `${path}[${index}]`)));
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (SECRET_KEY.test(key)) findings.push(`${path}.${key}`);
      findings.push(...inspectSecretKeys(item, `${path}.${key}`));
    }
  }
  return findings;
}

export function scanUiTruthEvidence(evidenceDirectory) {
  const failures = [];
  const renderedFiles = filesIn(join(evidenceDirectory, "rendered"), ".txt");
  const rendered = renderedFiles.map((path) => ({ path, name: basename(path), text: readFileSync(path, "utf8") }));

  if (rendered.length === 0) failures.push("没有可核验的渲染页面文本（rendered/*.txt）。");
  for (const page of rendered) {
    for (const pattern of FIXTURE_LEAKS) {
      if (pattern.test(page.text)) failures.push(`${page.name}: 出现测试/演示数据标识 ${pattern}`);
    }
    if (page.name.startsWith("client-") && page.text.includes("内容与信源")) {
      failures.push(`${page.name}: 客户工作台仍出现“内容与信源”。`);
    }
    for (const pattern of OLD_AI_TERMS) {
      if (pattern.test(page.text)) failures.push(`${page.name}: 国内 AI 检测术语未统一。`);
    }
    if (!page.text.includes("国内 GEO 运营与交付系统")) {
      failures.push(`${page.name}: 未显示统一系统名称。`);
    }
    if (/probe|ai-detection/iu.test(page.name) && !page.text.includes("国内 AI 检测")) {
      failures.push(`${page.name}: 未显示“国内 AI 检测”。`);
    }
  }

  const stubPages = rendered.filter((page) => page.text.includes("该功能尚未开放"));
  if (stubPages.length > 1) failures.push(`主工作台存在 ${stubPages.length} 个“该功能尚未开放”占位页。`);

  const accountFiles = filesIn(join(evidenceDirectory, "accounts"), ".json");
  if (accountFiles.length === 0) failures.push("没有账号安全投影证据（accounts/*.json）。");
  for (const path of accountFiles) {
    const findings = inspectSecretKeys(JSON.parse(readFileSync(path, "utf8")));
    if (findings.length) failures.push(`${basename(path)}: 出现秘密字段 ${findings.join(", ")}`);
  }

  const capabilityPath = join(evidenceDirectory, "capabilities.json");
  let capabilities = [];
  try {
    const parsed = JSON.parse(readFileSync(capabilityPath, "utf8"));
    capabilities = Array.isArray(parsed.capabilities) ? parsed.capabilities : [];
  } catch {
    failures.push("缺少或无法读取 capabilities.json。");
  }
  if (capabilities.length === 0) failures.push("能力证据未列出任何能力项。");
  for (const item of capabilities) {
    if (typeof item.apiWiring !== "boolean" || typeof item.usableCapability !== "boolean") {
      failures.push(`${item.id ?? "未知能力"}: API 接线与用户可用能力必须分别记录。`);
    }
    if (item.usableCapability === true && (!Array.isArray(item.evidence) || item.evidence.length === 0)) {
      failures.push(`${item.id ?? "未知能力"}: 用户可用能力缺少证据。`);
    }
  }

  return {
    decision: failures.length === 0 ? "PASS" : "FAIL",
    counts: {
      renderedPages: rendered.length,
      placeholderPages: stubPages.length,
      accountProjections: accountFiles.length,
      apiWiring: capabilities.filter((item) => item.apiWiring === true).length,
      usableCapabilities: capabilities.filter((item) => item.usableCapability === true).length,
    },
    failures,
  };
}
