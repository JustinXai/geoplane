import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const FIXTURE_LEAKS = [
  /Sample Local/iu,
  /Pilot Fixture/iu,
  /\bFixture\b/iu,
  /\bMock\b/iu,
  /Demo Client/iu,
  /Demo Agency/iu,
];
const ROLE_PAGES = [
  {
    role: "client",
    path: "/app",
    email: "client-owner@local-pilot.example.test",
    passwordEnv: "LOCAL_CLIENT_OWNER_PASSWORD",
    expectedSafeName: "本地验收客户",
  },
  {
    role: "agency",
    path: "/agency",
    email: "agency-owner@local-pilot.example.test",
    passwordEnv: "LOCAL_AGENCY_OWNER_PASSWORD",
    expectedSafeName: "本地验收代理商",
  },
  {
    role: "ops",
    path: "/ops",
    email: "platform-admin@local-pilot.example.test",
    passwordEnv: "LOCAL_PLATFORM_ADMIN_PASSWORD",
    expectedSafeName: "本地验收平台",
  },
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

function readEnvFile(path = ".env.local") {
  if (!existsSync(path)) return {};
  const values = {};
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const equals = line.indexOf("=");
    if (equals < 1) continue;
    const key = line.slice(0, equals).trim();
    let value = line.slice(equals + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key) values[key] = value;
  }
  return values;
}

function mergedEnvironment(env = process.env) {
  return { ...readEnvFile(), ...env };
}

function normalizeBaseUrl(value) {
  return String(value ?? "http://127.0.0.1:3000").replace(/\/+$/, "");
}

function passwordFor(role, env) {
  const value = env[role.passwordEnv] ?? env.LOCAL_PILOT_PASSWORD ?? env.TEST_LOGIN_PASSWORD;
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${role.passwordEnv} is required for runtime UI truth login`);
  }
  return value;
}

function firstCookie(setCookie) {
  const value = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  const first = value?.split(";")[0]?.trim();
  if (!first || !first.includes("=")) throw new Error("login did not return a session cookie");
  const equals = first.indexOf("=");
  return { header: first, name: first.slice(0, equals), value: first.slice(equals + 1) };
}

async function login(baseUrl, role, env) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseUrl },
    body: JSON.stringify({ email: role.email, password: passwordFor(role, env) }),
    redirect: "manual",
  });
  if (response.status !== 200) throw new Error(`${role.role} login failed with HTTP ${response.status}`);
  return firstCookie(response.headers.get("set-cookie"));
}

async function readBuildInfo(baseUrl, platformCookie) {
  const response = await fetch(`${baseUrl}/api/ops/build-info`, {
    headers: { cookie: platformCookie.header },
    redirect: "manual",
  });
  if (response.status !== 200) throw new Error(`build-info failed with HTTP ${response.status}`);
  const json = await response.json();
  if (!json?.ok || !json.data) throw new Error("build-info did not return an apiOk payload");
  return json.data;
}

async function freePort() {
  const { createServer } = await import("node:net");
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === "object") resolve(address.port);
        else reject(new Error("could not allocate a browser debugging port"));
      });
    });
  });
}

function browserCandidates() {
  return [
    process.env.UI_TRUTH_BROWSER,
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    `${process.env.LOCALAPPDATA ?? ""}\\Microsoft\\Edge\\Application\\msedge.exe`,
    `${process.env.LOCALAPPDATA ?? ""}\\Google\\Chrome\\Application\\chrome.exe`,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ].filter(Boolean);
}

function findBrowserExecutable() {
  const found = browserCandidates().find((path) => existsSync(path));
  if (!found) throw new Error("no Chromium/Edge executable found; set UI_TRUTH_BROWSER");
  return found;
}

async function waitForJson(url, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(150);
  }
  throw new Error(`browser debugger not ready: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

class CdpClient {
  constructor(webSocketUrl) {
    this.nextId = 1;
    this.pending = new Map();
    this.socket = new WebSocket(webSocketUrl);
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener("open", () => resolve());
      this.socket.addEventListener("error", () => reject(new Error("CDP websocket failed to open")), { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message ?? "CDP command failed"));
      else pending.resolve(message.result);
    });
  }

  async send(method, params = {}) {
    await this.ready;
    const id = this.nextId++;
    const result = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.socket.send(JSON.stringify({ id, method, params }));
    return result;
  }

  close() {
    try {
      this.socket.close();
    } catch {
      // Best-effort cleanup for the short-lived headless browser.
    }
  }
}

async function createPage(debugPort, targetUrl) {
  const response = await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(targetUrl)}`, { method: "PUT" });
  if (!response.ok) throw new Error(`browser target creation failed with HTTP ${response.status}`);
  return await response.json();
}

async function evaluateText(cdp) {
  const result = await cdp.send("Runtime.evaluate", {
    expression: "document.body ? document.body.innerText : ''",
    returnByValue: true,
  });
  return String(result?.result?.value ?? "");
}

async function capturePageText({ baseUrl, debugPort, role, cookie }) {
  const target = await createPage(debugPort, `${baseUrl}/login`);
  const cdp = new CdpClient(target.webSocketDebuggerUrl);
  try {
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Network.enable");
    const origin = new URL(baseUrl);
    await cdp.send("Network.setCookie", {
      name: cookie.name,
      value: cookie.value,
      url: baseUrl,
      domain: origin.hostname,
      path: "/",
      httpOnly: true,
      secure: origin.protocol === "https:",
      sameSite: "Lax",
    });
    await cdp.send("Page.navigate", { url: `${baseUrl}${role.path}` });
    const deadline = Date.now() + 15_000;
    let text = "";
    while (Date.now() < deadline) {
      await sleep(300);
      text = await evaluateText(cdp);
      const resolvedOrganization =
        text.includes(role.expectedSafeName) || FIXTURE_LEAKS.some((pattern) => pattern.test(text));
      if (text.includes("国内 GEO 运营与交付系统") && text.includes("当前组织") && resolvedOrganization) break;
    }
    return { role: role.role, path: role.path, expectedSafeName: role.expectedSafeName, text };
  } finally {
    cdp.close();
  }
}

/**
 * @param {{ pages?: readonly any[], buildInfo?: any, expectedGitSha?: string, staticReport?: any }} input
 */
export function evaluateRuntimeUiTruth({ pages, buildInfo, expectedGitSha, staticReport = null }) {
  const failures = [];
  if (!Array.isArray(pages) || pages.length !== ROLE_PAGES.length) {
    failures.push("必须提供三角色真实运行页面 DOM 文本。");
  }
  for (const role of ROLE_PAGES) {
    const page = pages?.find((item) => item.role === role.role || item.path === role.path);
    if (!page) {
      failures.push(`${role.path}: 缺少真实运行页面 DOM。`);
      continue;
    }
    const text = String(page.text ?? "");
    if (!text.includes("国内 GEO 运营与交付系统")) failures.push(`${role.path}: 未显示统一系统名称。`);
    if (!text.includes("当前组织")) failures.push(`${role.path}: 未包含 WorkspaceShell 顶部组织区域。`);
    if (!text.includes(role.expectedSafeName)) failures.push(`${role.path}: 顶部组织未显示中文安全名称 ${role.expectedSafeName}。`);
    for (const pattern of FIXTURE_LEAKS) {
      if (pattern.test(text)) failures.push(`${role.path}: 真实 DOM 出现测试/演示数据标识 ${pattern}`);
    }
  }
  const runtimeSha = typeof buildInfo?.gitSha === "string" ? buildInfo.gitSha.trim() : "";
  const expectedSha = typeof expectedGitSha === "string" ? expectedGitSha.trim() : "";
  if (!runtimeSha) failures.push("运行实例未返回 Build SHA。");
  if (!expectedSha) failures.push("未提供当前代码 HEAD。");
  if (runtimeSha && expectedSha && runtimeSha !== expectedSha) {
    failures.push(`运行实例 Build SHA ${runtimeSha} 与当前 HEAD ${expectedSha} 不一致。`);
  }
  return {
    decision: failures.length === 0 ? "PASS" : "FAIL",
    runtime: {
      basePages: pages?.map((page) => ({ role: page.role, path: page.path, characters: String(page.text ?? "").length })) ?? [],
      buildSha: runtimeSha || null,
      expectedGitSha: expectedSha || null,
    },
    staticEvidence: staticReport
      ? { decision: staticReport.decision, counts: staticReport.counts, failures: staticReport.failures }
      : null,
    failures,
  };
}

export async function collectRuntimeUiTruth({ baseUrl = "http://127.0.0.1:3000", env = process.env } = {}) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const merged = mergedEnvironment(env);
  const logins = new Map();
  for (const role of ROLE_PAGES) {
    logins.set(role.role, await login(normalizedBaseUrl, role, merged));
  }
  const buildInfo = await readBuildInfo(normalizedBaseUrl, logins.get("ops"));

  const debugPort = await freePort();
  const userDataDir = mkdtempSync(join(tmpdir(), "geo-ui-truth-browser-"));
  const browser = spawn(findBrowserExecutable(), [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataDir}`,
    "about:blank",
  ], { stdio: "ignore", windowsHide: true });
  try {
    await waitForJson(`http://127.0.0.1:${debugPort}/json/version`);
    const pages = [];
    for (const role of ROLE_PAGES) {
      pages.push(await capturePageText({
        baseUrl: normalizedBaseUrl,
        debugPort,
        role,
        cookie: logins.get(role.role),
      }));
    }
    return { pages, buildInfo };
  } finally {
    browser.kill();
    rmSync(userDataDir, { recursive: true, force: true });
  }
}
