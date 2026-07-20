#!/usr/bin/env node
/**
 * P0_BUSINESS_SCENARIO_EVIDENCE_CLOSURE_V1
 * Executes real business scenarios against local acceptance database.
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, "..", "..", "outputs", "p0-scenarios");

function readEnvFile(path) {
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

const env = { ...readEnvFile(join(__dirname, "..", "..", ".env.local")), ...process.env };
const BASE_URL = env.UI_TRUTH_BASE_URL ?? "http://127.0.0.1:3000";

const ROLES = [
  {
    role: "client",
    email: env.LOCAL_CLIENT_OWNER_PASSWORD ? "client-owner@local-pilot.example.test" : undefined,
    passwordEnv: "LOCAL_CLIENT_OWNER_PASSWORD",
  },
  {
    role: "agency",
    email: env.LOCAL_AGENCY_OWNER_PASSWORD ? "agency-owner@local-pilot.example.test" : undefined,
    passwordEnv: "LOCAL_AGENCY_OWNER_PASSWORD",
  },
  {
    role: "ops",
    email: env.LOCAL_PLATFORM_ADMIN_PASSWORD ? "platform-admin@local-pilot.example.test" : undefined,
    passwordEnv: "LOCAL_PLATFORM_ADMIN_PASSWORD",
  },
].filter(r => env[r.passwordEnv]);

function passwordFor(role) {
  const value = env[role.passwordEnv];
  if (!value) throw new Error(`${role.passwordEnv} is required`);
  return value;
}

function firstCookie(setCookie) {
  const value = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  const first = value?.split(";")[0]?.trim();
  if (!first || !first.includes("=")) throw new Error("no session cookie");
  const equals = first.indexOf("=");
  return { header: first, name: first.slice(0, equals), value: first.slice(equals + 1) };
}

async function login(role) {
  const response = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE_URL },
    body: JSON.stringify({ email: role.email, password: passwordFor(role) }),
    redirect: "manual",
  });
  if (response.status !== 200) {
    throw new Error(`${role.role} login failed: HTTP ${response.status}`);
  }
  return firstCookie(response.headers.get("set-cookie"));
}

async function api(method, path, cookie, body = undefined) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      origin: BASE_URL,
      cookie: cookie.header,
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { status: response.status, headers: Object.fromEntries(response.headers.entries()), data };
}

async function logout(cookie) {
  await api("POST", "/api/auth/logout", cookie);
}

async function getProjectId(cookie) {
  const result = await api("GET", "/api/projects", cookie);
  const projects = result.data?.data ?? result.data ?? [];
  return projects[0]?.id ?? null;
}

async function ensureKnowledgePackage(projectId, cookie) {
  const checkResult = await api("GET", `/api/projects/${projectId}/knowledge`, cookie);
  if (checkResult.data?.data?.package) {
    return checkResult.data.data.package.id;
  }
  const createResult = await api("POST", `/api/projects/${projectId}/knowledge/packages`, cookie, {
    title: "本地验收测试知识包",
    classification: "INTERNAL",
  });
  return createResult.data?.data?.id ?? null;
}

async function getOrganizationId(cookie) {
  const result = await api("GET", "/api/auth/me", cookie);
  return result.data?.data?.organization?.id ?? null;
}

// ============ SCENARIO A: No-Keyword Full Chain ============
async function scenarioA(clientCookie, opsCookie) {
  console.log("\n=== SCENARIO A: No-Keyword Full Chain ===");
  const evidence = { scenario: "A", timestamp: new Date().toISOString(), steps: [] };

  // Step 1: Get project
  const projectResult = await api("GET", "/api/projects", clientCookie);
  const projectId = projectResult.data?.data?.[0]?.id
    ?? projectResult.data?.data?.projects?.[0]?.id
    ?? projectResult.data?.projects?.[0]?.id;
  evidence.steps.push({ step: "listProjects", status: projectResult.status, projectId });
  console.log(`  Project ID: ${projectId}`);

  if (!projectId) {
    evidence.error = "No project found";
    return evidence;
  }

  // Step 2: Ensure KnowledgePackage exists
  const kpId = await ensureKnowledgePackage(projectId, clientCookie);
  evidence.steps.push({ step: "ensureKnowledgePackage", packageId: kpId });
  console.log(`  KnowledgePackage ID: ${kpId}`);

  // Step 3: Check KeywordDataset (should not exist)
  const dsResult = await api("GET", `/api/keywords/projects/${projectId}/overview`, clientCookie);
  const datasets = dsResult.data?.data?.datasets ?? [];
  evidence.steps.push({ step: "checkKeywords", status: dsResult.status, datasetCount: datasets.length });
  console.log(`  Keyword Datasets: ${datasets.length}`);

  // Step 4: Generate question candidates (Knowledge-first)
  const previewResult = await api("POST", `/api/projects/${projectId}/knowledge-opportunities/preview`, clientCookie, {});
  const preview = previewResult.data?.data;
  console.log(`  DEBUG preview:`, JSON.stringify(preview).slice(0, 300));
  evidence.steps.push({ step: "previewOpportunity", status: previewResult.status, hasPreview: !!preview });
  console.log(`  Preview: ${preview ? "generated" : "none"}`);

  let opportunityId = null;
  if (preview) {
    // Step 5: Create Opportunity with candidateId and knowledgePackageId
    const createResult = await api("POST", `/api/commands/projects/${projectId}/knowledge-opportunities`, clientCookie, {
      knowledgePackageId: kpId,
      candidateId: preview.candidates?.[0]?.id ?? preview.id,
    });
    opportunityId = createResult.data?.data?.opportunityId ?? createResult.data?.data?.id;
    evidence.steps.push({ step: "createOpportunity", status: createResult.status, opportunityId, rawError: createResult.data?.error });
    console.log(`  Opportunity ID: ${opportunityId}, Status: ${createResult.status}`);

    if (opportunityId) {
      // Step 6: Verify Opportunity properties
      const oppResult = await api("GET", `/api/projects/${projectId}/knowledge-opportunities`, clientCookie);
      const opp = oppResult.data?.data?.opportunities?.find(o => o.id === opportunityId);
      evidence.steps.push({
        step: "verifyOpportunity",
        status: oppResult.status,
        hasDemandEvidence: opp?.demandEvidenceCount > 0,
        titleLanguage: /[\u4e00-\u9fa5]/.test(opp?.title ?? "") ? "chinese" : "other",
        sourceType: opp?.sourceType,
      });
      console.log(`  Opportunity verified: source=${opp?.sourceType}, hasDemand=${opp?.demandEvidenceCount > 0}`);

      // Step 7: Enter content production - get Brief
      const briefResult = await api("POST", `/api/commands/projects/${projectId}/knowledge-opportunities/${opportunityId}/briefs`, clientCookie, {});
      const briefId = briefResult.data?.data?.id;
      evidence.steps.push({ step: "createBrief", status: briefResult.status, briefId });
      console.log(`  Brief ID: ${briefId}`);

      let draftId = null;
      if (briefId) {
        // Step 8: Create draft
        const draftResult = await api("POST", `/api/commands/projects/${projectId}/briefs/${briefId}/drafts`, clientCookie, {});
        draftId = draftResult.data?.data?.id;
        evidence.steps.push({ step: "createDraft", status: draftResult.status, draftId });
        console.log(`  Draft ID: ${draftId}`);

        // Step 9: Execute lightweight gate
        const gateResult = await api("POST", `/api/commands/projects/${projectId}/drafts/${draftId}/gate`, clientCookie, {});
        evidence.steps.push({ step: "gate", status: gateResult.status, gatePassed: gateResult.data?.ok });
        console.log(`  Gate: ${gateResult.data?.ok ? "PASS" : "FAIL"}`);

        // Step 10: Human review
        const reviewResult = await api("POST", `/api/commands/projects/${projectId}/drafts/${draftId}/submit-review`, clientCookie, {});
        const reviewId = reviewResult.data?.data?.reviewId ?? reviewResult.data?.data?.id;
        evidence.steps.push({ step: "submitReview", status: reviewResult.status, reviewId });
        console.log(`  Review ID: ${reviewId}`);

        // Step 11: Approve review
        if (reviewId) {
          const approveResult = await api("POST", `/api/commands/projects/${projectId}/reviews/${reviewId}/decisions`, clientCookie, { decision: "APPROVED", notes: "Local acceptance test" });
          evidence.steps.push({ step: "approveReview", status: approveResult.status });
          console.log(`  Review approved: ${approveResult.status}`);
        }

        // Step 12: Register delivery receipt
        const deliveryResult = await api("POST", `/api/commands/projects/${projectId}/deliveries`, clientCookie, { reference: `A-TEST-${Date.now()}` });
        const deliveryId = deliveryResult.data?.data?.id;
        evidence.steps.push({ step: "registerDelivery", status: deliveryResult.status, deliveryId });
        console.log(`  Delivery ID: ${deliveryId}`);

        // Store for refresh test
        evidence.refreshTarget = { opportunityId, briefId, draftId, deliveryId };
      }
    }
  }

  // Step 13: Refresh - re-read state
  if (evidence.refreshTarget) {
    const refreshResult = await api("GET", `/api/projects/${projectId}/knowledge-opportunities`, clientCookie);
    evidence.steps.push({
      step: "refreshAfterActions",
      status: refreshResult.status,
      opportunitiesCount: refreshResult.data?.data?.opportunities?.length ?? 0,
    });
    console.log(`  Refreshed opportunities: ${refreshResult.data?.data?.opportunities?.length}`);
  }

  return evidence;
}

// ============ SCENARIO B: Manual Keyword Full Chain ============
async function scenarioB(clientCookie) {
  console.log("\n=== SCENARIO B: Manual Keyword Full Chain ===");
  const evidence = { scenario: "B", timestamp: new Date().toISOString(), steps: [] };

  // Get project
  const projectResult = await api("GET", "/api/projects", clientCookie);
  const projectId = projectResult.data?.data?.[0]?.id
    ?? projectResult.data?.data?.projects?.[0]?.id
    ?? projectResult.data?.projects?.[0]?.id;
  evidence.steps.push({ step: "getProject", status: projectResult.status, projectId });
  console.log(`  Project ID: ${projectId}`);

  if (!projectId) {
    evidence.error = "No project found";
    return evidence;
  }

  // Step 1: Create manual keyword dataset
  const dsResult = await api("POST", "/api/generic-keywords/datasets", clientCookie, {
    projectId,
    name: "人工关键词测试",
    source: "MANUAL",
  });
  const datasetId = dsResult.data?.data?.id;
  evidence.steps.push({ step: "createDataset", status: dsResult.status, datasetId });
  console.log(`  Dataset ID: ${datasetId}`);

  if (!datasetId) {
    evidence.error = "Failed to create dataset";
    return evidence;
  }

  // Step 2: Add manual keyword
  const kwResult = await api("POST", `/api/generic-keywords/datasets/${datasetId}/records`, clientCookie, {
    projectId,
    keyword: "企业GEO优化",
    category: "核心服务",
    notes: "本地测试关键词",
  });
  const recordId = kwResult.data?.data?.id;
  evidence.steps.push({ step: "addKeyword", status: kwResult.status, recordId });
  console.log(`  Keyword Record ID: ${recordId}`);

  if (!recordId) {
    evidence.error = "Failed to add keyword";
    return evidence;
  }

  // Step 3: Submit for review
  const pkgResult = await api("POST", "/api/generic-keywords/review-packages", clientCookie, {
    projectId,
    datasetId,
    keywordRecordIds: [recordId],
    version: 1,
  });
  const packageId = pkgResult.data?.data?.id;
  evidence.steps.push({ step: "createReviewPackage", status: pkgResult.status, packageId, rawError: pkgResult.data?.error });
  console.log(`  Review Package ID: ${packageId}, Status: ${pkgResult.status}`);

  // Step 4: Approve keyword
  if (packageId) {
    const decideResult = await api("POST", `/api/generic-keywords/review-packages/${packageId}/decisions`, clientCookie, {
      decisions: [{ keywordRecordId: recordId, decision: "CONFIRMED" }],
    });
    evidence.steps.push({ step: "approveKeyword", status: decideResult.status, hasEvidence: false });
    console.log(`  Keyword approved: ${decideResult.status}`);

    // Step 5: Enhance AI expansion
    const expandResult = await api("POST", "/api/keyword-expansion/preview", clientCookie, {
      projectId,
      reason: "本地验收测试",
      groups: [{ type: "MAIN", values: ["企业GEO优化"] }, { type: "QUESTION", values: ["{keyword}如何实施？"] }],
    });
    evidence.steps.push({ step: "keywordExpansion", status: expandResult.status, hasExpanded: !!expandResult.data?.data });
    console.log(`  AI Expansion: ${expandResult.data?.data ? "done" : "none"}`);

    // Step 6: Generate question candidates
    const qcResult = await api("POST", `/api/projects/${projectId}/knowledge-opportunities/preview`, clientCookie, {
      keywordRecordId: recordId,
    });
    evidence.steps.push({ step: "generateQuestions", status: qcResult.status, hasCandidates: !!qcResult.data?.data });
    console.log(`  Question Candidates: ${qcResult.data?.data ? "generated" : "none"}`);

    // Step 7: Create Opportunity from keyword
    if (qcResult.data?.data) {
      const oppResult = await api("POST", `/api/commands/projects/${projectId}/knowledge-opportunities`, clientCookie, { keywordRecordId: recordId });
      const oppId = oppResult.data?.data?.id;
      evidence.steps.push({ step: "createKeywordOpportunity", status: oppResult.status, opportunityId: oppId });
      console.log(`  Opportunity ID: ${oppId}`);
      evidence.refreshTarget = { opportunityId: oppId };
    }
  }

  // Step 8: Refresh verification
  if (evidence.refreshTarget?.opportunityId) {
    const refreshResult = await api("GET", `/api/projects/${projectId}/knowledge-opportunities`, clientCookie);
    const opp = refreshResult.data?.data?.opportunities?.find(o => o.id === evidence.refreshTarget.opportunityId);
    evidence.steps.push({
      step: "refreshVerify",
      status: refreshResult.status,
      oppExists: !!opp,
      demandEvidenceCount: opp?.demandEvidenceCount ?? 0,
    });
    console.log(`  Refresh - Opportunity exists: ${!!opp}, DemandEvidence: ${opp?.demandEvidenceCount ?? 0}`);
  }

  return evidence;
}

// ============ SCENARIO C: Generic CSV/XLSX Chain ============
async function scenarioC(clientCookie) {
  console.log("\n=== SCENARIO C: Generic CSV/XLSX Chain ===");
  const evidence = { scenario: "C", timestamp: new Date().toISOString(), steps: [] };

  // Get project
  const projectResult = await api("GET", "/api/projects", clientCookie);
  const projectId = projectResult.data?.data?.[0]?.id
    ?? projectResult.data?.data?.projects?.[0]?.id
    ?? projectResult.data?.projects?.[0]?.id;
  evidence.steps.push({ step: "getProject", status: projectResult.status, projectId });
  console.log(`  Project ID: ${projectId}`);

  if (!projectId) {
    evidence.error = "No project found";
    return evidence;
  }

  // Create generic CSV
  const csv = "关键词,分类,备注\n企业GEO服务,核心服务,本地测试数据\n内容营销策略,营销策略,本地测试数据";
  const base64 = Buffer.from(csv).toString("base64");

  // Step 1: Create import batch
  const importResult = await api("POST", "/api/generic-keywords/imports", clientCookie, {
    projectId,
    fileName: "local-test.csv",
    base64,
  });
  const batchId = importResult.data?.data?.batchId ?? importResult.data?.data?.id;
  evidence.steps.push({ step: "createImportBatch", status: importResult.status, batchId });
  console.log(`  Import Batch ID: ${batchId}`);

  // Step 2: Get overview to see imported keywords
  const overviewResult = await api("GET", `/api/generic-keywords/projects/${projectId}`, clientCookie);
  const datasets = overviewResult.data?.data?.datasets ?? [];
  const latestDataset = datasets[datasets.length - 1];
  const datasetId = latestDataset?.id;
  evidence.steps.push({
    step: "checkImportedDataset",
    status: overviewResult.status,
    datasetId,
    recordCount: latestDataset?.recordCount ?? 0,
    hasBaiduFields: false, // Generic file should not require Baidu fields
  });
  console.log(`  Dataset ID: ${datasetId}, Records: ${latestDataset?.recordCount ?? 0}`);

  if (datasetId) {
    // Step 3: Create review package
    const pkgResult = await api("POST", "/api/generic-keywords/review-packages", clientCookie, {
      projectId,
      datasetId,
    });
    const packageId = pkgResult.data?.data?.id;
    evidence.steps.push({ step: "createReviewPackage", status: pkgResult.status, packageId });

    // Step 4: Approve records
    if (packageId) {
      const records = overviewResult.data?.data?.records ?? [];
      const decisions = records.map(r => ({ keywordRecordId: r.id, decision: "CONFIRMED" }));
      const decideResult = await api("POST", `/api/generic-keywords/review-packages/${packageId}/decisions`, clientCookie, { decisions });
      evidence.steps.push({ step: "approveRecords", status: decideResult.status, count: decisions.length });
      console.log(`  Approved ${decisions.length} records`);

      // Step 5: Refresh and verify
      const refreshResult = await api("GET", `/api/generic-keywords/projects/${projectId}`, clientCookie);
      evidence.steps.push({
        step: "refreshVerify",
        status: refreshResult.status,
        verifiedCount: refreshResult.data?.data?.decisions?.filter(d => d.decision === "CONFIRMED").length ?? 0,
      });
      console.log(`  Verified confirmed: ${refreshResult.data?.data?.decisions?.filter(d => d.decision === "CONFIRMED").length ?? 0}`);
    }
  }

  return evidence;
}

// ============ SCENARIO D: Agency Delivery Closure ============
async function scenarioD(agencyCookie, clientOrgId) {
  console.log("\n=== SCENARIO D: Agency Delivery Closure ===");
  const evidence = { scenario: "D", timestamp: new Date().toISOString(), steps: [] };

  // Set agency context to act as client
  const ctxResult = await api("POST", "/api/agency/context", agencyCookie, { clientOrganizationId: clientOrgId });
  evidence.steps.push({ step: "setAgencyContext", status: ctxResult.status });
  console.log(`  Agency context set: ${ctxResult.status}`);

  // Get authorized clients
  const clientsResult = await api("GET", "/api/agency/clients", agencyCookie);
  const clients = clientsResult.data?.data ?? [];
  const actualClientOrgId = clients[0]?.clientOrganizationId ?? clientOrgId;
  evidence.steps.push({ step: "listClients", status: clientsResult.status, clientCount: clients.length });
  console.log(`  Authorized Clients: ${clients.length}`);

  if (!actualClientOrgId) {
    evidence.error = "No authorized clients found";
    return evidence;
  }

  // Get project from client
  const projectResult = await api("GET", "/api/projects", agencyCookie);
  const projects = projectResult.data?.data ?? [];
  const projectId = projects[0]?.id;
  evidence.steps.push({ step: "getProject", status: projectResult.status, projectId });
  console.log(`  Project ID: ${projectId}`);

  if (!projectId) {
    evidence.error = "No agency projects found";
    return evidence;
  }

  // Step 1: View project tasks
  const tasksResult = await api("GET", `/api/projects/${projectId}/tasks`, agencyCookie);
  evidence.steps.push({ step: "viewTasks", status: tasksResult.status, taskCount: tasksResult.data?.data?.length ?? 0 });
  console.log(`  Tasks: ${tasksResult.data?.data?.length ?? 0}`);

  // Step 2: Register delivery
  const deliveryResult = await api("POST", "/api/agency-delivery/deliveries", agencyCookie, {
    clientOrganizationId: actualClientOrgId,
    projectId,
    action: "REGISTER_DELIVERED",
    receiptReference: `D-TEST-${Date.now()}`,
  });
  const deliveryId = deliveryResult.data?.data?.id;
  evidence.steps.push({ step: "registerDelivery", status: deliveryResult.status, deliveryId });
  console.log(`  Delivery ID: ${deliveryId}`);

  // Step 3: Workflow transition
  const workflowResult = await api("POST", "/api/agency-delivery/workflow", agencyCookie, {
    clientOrganizationId: actualClientOrgId,
    projectId,
    stage: "CONTENT_REVIEW",
    toStatus: "COMPLETED",
    reason: "本地验收测试完成",
  });
  evidence.steps.push({ step: "workflowTransition", status: workflowResult.status });
  console.log(`  Workflow transition: ${workflowResult.status}`);

  // Step 4: Refresh verification
  if (deliveryId) {
    const refreshResult = await api("GET", `/api/projects/${projectId}/deliveries`, agencyCookie);
    evidence.steps.push({
      step: "refreshVerify",
      status: refreshResult.status,
      deliveryExists: !![(refreshResult.data?.data ?? []).find(d => d.id === deliveryId)],
    });
    console.log(`  Refresh - Delivery exists: ${!![(refreshResult.data?.data ?? []).find(d => d.id === deliveryId)]}`);
  }

  return evidence;
}

// ============ SCENARIO E: Permission Rejection ============
async function scenarioE(clientCookie, agencyCookie, opsCookie) {
  console.log("\n=== SCENARIO E: Permission Rejection ===");
  const evidence = { scenario: "E", timestamp: new Date().toISOString(), steps: [] };

  // Get client project
  const projectResult = await api("GET", "/api/projects", clientCookie);
  const projectId = projectResult.data?.data?.[0]?.id
    ?? projectResult.data?.data?.projects?.[0]?.id
    ?? projectResult.data?.projects?.[0]?.id;
  evidence.steps.push({ step: "getClientProject", status: projectResult.status, projectId });
  console.log(`  Client Project ID: ${projectId}`);

  if (!projectId) {
    evidence.error = "No project found";
    return evidence;
  }

  // Step 1: Client cannot access platform ops
  const opsCheck = await api("GET", "/api/ops/build-info", clientCookie);
  evidence.steps.push({
    step: "clientAccessPlatform",
    expectedStatus: 403,
    actualStatus: opsCheck.status,
    rejected: opsCheck.status === 403,
  });
  console.log(`  Client -> Platform: ${opsCheck.status} (expected 403, rejected: ${opsCheck.status === 403})`);

  // Step 2: Client cannot access agency delivery
  const agencyDelivery = await api("POST", "/api/agency-delivery/deliveries", clientCookie, {
    projectId,
    action: "REGISTER_DELIVERED",
    receiptReference: "UNAUTHORIZED",
  });
  evidence.steps.push({
    step: "clientAccessAgencyDelivery",
    expectedStatus: 403,
    actualStatus: agencyDelivery.status,
    rejected: agencyDelivery.status === 403,
  });
  console.log(`  Client -> Agency Delivery: ${agencyDelivery.status} (expected 403, rejected: ${agencyDelivery.status === 403})`);

  // Step 3: Agency cannot access other client projects
  const otherClientCheck = await api("GET", "/api/projects", agencyCookie);
  evidence.steps.push({
    step: "agencyAccessClient",
    actualStatus: otherClientCheck.status,
    isEmpty: otherClientCheck.status === 200 && (otherClientCheck.data?.data?.projects?.length ?? 0) === 0,
  });
  console.log(`  Agency -> Client Projects: ${otherClientCheck.status}`);

  // Step 4: Ops can access platform
  const opsAccess = await api("GET", "/api/ops/build-info", opsCookie);
  evidence.steps.push({
    step: "opsAccessPlatform",
    actualStatus: opsAccess.status,
    allowed: opsAccess.status === 200,
  });
  console.log(`  Ops -> Platform: ${opsAccess.status} (allowed: ${opsAccess.status === 200})`);

  // Step 5: Verify no secrets in account projection
  const meResult = await api("GET", "/api/auth/me", clientCookie);
  const me = meResult.data?.data ?? {};
  const secretFields = ["password", "token", "cookie", "secret", "credential", "apiKey"];
  const hasSecrets = secretFields.some(f => Object.keys(me).some(k => k.toLowerCase().includes(f)));
  evidence.steps.push({
    step: "accountProjectionSanitized",
    status: meResult.status,
    hasSecrets,
    returnedFields: Object.keys(me).filter(k => !secretFields.some(f => k.toLowerCase().includes(f))),
  });
  console.log(`  Account projection sanitized: ${!hasSecrets}`);

  return evidence;
}

// ============ MAIN ============
async function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  console.log(`Output directory: ${OUTPUT_DIR}`);
  console.log(`Base URL: ${BASE_URL}`);

  const results = {};

  try {
    // Login all roles
    console.log("\n=== LOGGING IN ===");
    const cookies = {};
    for (const role of ROLES) {
      console.log(`  Logging in as ${role.role}...`);
      cookies[role.role] = await login(role);
      console.log(`  ${role.role}: OK (cookie: ${cookies[role.role].name})`);
    }

    // Run scenarios
    results.sceneA = await scenarioA(cookies.client, cookies.ops);
    results.sceneB = await scenarioB(cookies.client);
    results.sceneC = await scenarioC(cookies.client);
    results.sceneD = await scenarioD(cookies.agency, "e0c0d2ca-6be0-459e-9392-b90b8584eb48");
    results.sceneE = await scenarioE(cookies.client, cookies.agency, cookies.ops);

    // Relogin test (Scene A post-logout)
    console.log("\n=== RE-LOGIN PERSISTENCE TEST ===");
    await logout(cookies.client);
    console.log("  Logged out client");
    cookies.client = await login(ROLES.find(r => r.role === "client"));
    console.log("  Re-logged in client");

    const reLoginResult = await api("GET", "/api/projects", cookies.client);
    results.reloginPersistence = {
      status: reLoginResult.status,
      projectsAccessible: reLoginResult.status === 200,
    };
    console.log(`  Projects accessible after re-login: ${reLoginResult.status === 200}`);

  } catch (error) {
    results.error = error instanceof Error ? error.message : String(error);
    console.error(`\nFATAL: ${results.error}`);
  } finally {
    // Write evidence (no secrets)
    const safeResults = JSON.parse(JSON.stringify(results, (key, value) => {
      if (key === "header" || key === "value" || key === "password") return "[REDACTED]";
      return value;
    }, 2));

    const outputFile = join(OUTPUT_DIR, `scenarios-${Date.now()}.json`);
    writeFileSync(outputFile, JSON.stringify(safeResults, null, 2));
    console.log(`\nEvidence written to: ${outputFile}`);

    // Summary
    console.log("\n=== SUMMARY ===");
    const passed = Object.entries(results)
      .filter(([k, v]) => k.startsWith("scene") && !v.error)
      .map(([k, v]) => ({ scenario: k, error: v.error, steps: v.steps?.filter(s => s.status >= 400) ?? [] }))
      .filter(r => r.steps.length === 0 && !r.error);

    console.log(`Scenarios passed: ${passed.length}/5`);
    console.log(`Scenarios with errors: ${5 - passed.length}`);
  }
}

main().catch(console.error);
