/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * reconstruction_source: docs/architecture/SYSTEM_BLUEPRINT_V1.md ("ops console" surface,
 *   "Publication principles" - platform-neutral, no automatic publication, WeChatSync-style
 *   integrations are future/opt-in, not enabled by default), docs/architecture/
 *   MULTI_TENANT_ACCOUNT_MODEL_V1.md (PLATFORM/AGENCY/CLIENT organization types, "A PLATFORM
 *   user can manage all organizations", AssignmentForm/AgencyClientCreateForm evidence,
 *   tenancyRepository.revokeInvitation behind requireSurfaceAuthorization("ops"),
 *   tenancyRepository.listAudit rendering actor/action/target/timestamp), docs/governance/
 *   SYSTEM_INVARIANTS_V1.md ("Tenant isolation", "Publication", "No customer data, no
 *   secrets"), recovered/partial-source/00040000000C9C6422CCAB4F-page.tsx (REAL recovered
 *   AuditPage: tenancyRepository.listAudit() rendered as a 时间/动作/目标/操作者 table with
 *   actorUserId truncated to 8 characters via actorUserId.slice(0,8) - see the 账户审计
 *   section below, which is the one part of this file with direct code-level corroboration
 *   rather than being reconstructed from the frozen spec alone), recovered/partial-source/
 *   00040000000C9C455B787075-route.ts (requireSurfaceAuthorization("ops"))
 * reconstruction_reason: no original fixture/page code recoverable beyond the 7 files
 *   already in recovered/partial-source/
 * original_file_unavailable: true
 *
 * Checkpoint C4 fixture data for the PLATFORM/ops workspace surfaces (/ops/*). Plain
 * in-memory arrays/objects only - no database, no real customer data, no network calls.
 * View-model types below are local to this lane (they intentionally do NOT import from
 * another lane's src/contracts) and follow the same conventions established in
 * src/app/app/_fixtures.ts and src/app/agency/_fixtures.ts:
 *
 * - every identifier is a short human-readable reference code (e.g. "ORG-0001"), never a
 *   raw UUID or database primary key - EXCEPT the 账户审计 section below, which
 *   deliberately models a UUID-shaped internal actorUserId (matching the recovered
 *   evidence's real field name/shape) and then truncates it to 8 characters before it is
 *   ever placed in a display string, exactly mirroring the recovered
 *   actorUserId.slice(0,8) pattern. The full, untruncated actorUserId is never collected
 *   into a display-string list and never rendered.
 * - no AI/model provider or vendor name ever appears in a display string, most importantly
 *   on the 模型与用量 (models & usage) surface - fixture "model" identities below are
 *   genericized as "模型 A" / "模型 B" style labels with an internal reference code, never
 *   a real vendor/product name (OpenAI, DeepSeek, Anthropic/Claude, etc.)
 * - the 发布连接器 (publisher connectors) fixture always shows 0 connectors in an
 *   enabled/connected state, per SYSTEM_INVARIANTS_V1 "Publication" ("External publisher
 *   integrations ... are future, opt-in, explicit - never wired in as a default path")
 * - 执行记录 and Evidence 审计 are intentionally minimal/opaque: id + status + timestamp
 *   only, no invented provider-call or evidence-payload schema (presentation only)
 * - 审核队列 here is the platform-wide view (all organizations), in contrast with
 *   src/app/agency/_fixtures.ts REVIEW_QUEUE_ITEMS which is scoped to the agency's own
 *   ACTIVE-assignment clients; same rule as C3 - presentation only, no real approve/reject
 *   wiring
 * - 客户分配 here is the platform-wide AgencyClientAssignment view (all agencies, all
 *   clients), in contrast with src/app/agency/_fixtures.ts AGENCY_CLIENT_ASSIGNMENTS which
 *   is scoped to a single acting agency
 *
 * tests/ops-workspace-copy.test.ts asserts this file's display strings hold to those rules.
 */

// ---------------------------------------------------------------------------
// 组织 (organizations) - all organizations across all types, platform-only visibility
// per MULTI_TENANT_ACCOUNT_MODEL_V1 ("A PLATFORM user can manage all organizations").
// ---------------------------------------------------------------------------

export type OrganizationType = "PLATFORM" | "AGENCY" | "CLIENT";

export interface OrganizationView {
  readonly referenceCode: string;
  readonly name: string;
  readonly type: OrganizationType;
  readonly typeLabel: string;
  readonly statusLabel: string;
  readonly createdLabel: string;
}

export const ORGANIZATIONS: readonly OrganizationView[] = [
  {
    referenceCode: "ORG-0001",
    name: "示例平台运营方",
    type: "PLATFORM",
    typeLabel: "平台",
    statusLabel: "已启用",
    createdLabel: "2026-01-05",
  },
  {
    referenceCode: "ORG-0014",
    name: "示例代理商甲",
    type: "AGENCY",
    typeLabel: "代理商",
    statusLabel: "已启用",
    createdLabel: "2026-02-10",
  },
  {
    referenceCode: "ORG-0019",
    name: "示例代理商乙",
    type: "AGENCY",
    typeLabel: "代理商",
    statusLabel: "已启用",
    createdLabel: "2026-03-02",
  },
  {
    referenceCode: "ORG-0002",
    name: "示例客户企业",
    type: "CLIENT",
    typeLabel: "客户",
    statusLabel: "已启用",
    createdLabel: "2026-02-18",
  },
  {
    referenceCode: "ORG-0007",
    name: "示例制造企业",
    type: "CLIENT",
    typeLabel: "客户",
    statusLabel: "已启用",
    createdLabel: "2026-03-20",
  },
  {
    referenceCode: "ORG-0011",
    name: "示例零售企业（历史客户）",
    type: "CLIENT",
    typeLabel: "客户",
    statusLabel: "已停用",
    createdLabel: "2026-01-30",
  },
] as const;

// ---------------------------------------------------------------------------
// 客户分配 (client assignments) - platform-wide view of every AgencyClientAssignment
// record, across all agencies. Contrast with src/app/agency/_fixtures.ts
// AGENCY_CLIENT_ASSIGNMENTS, which is scoped to one acting agency.
// ---------------------------------------------------------------------------

export type PlatformAssignmentStatus = "ACTIVE" | "REVOKED";

export interface PlatformClientAssignmentView {
  readonly referenceCode: string;
  readonly agencyOrgName: string;
  readonly clientOrgName: string;
  readonly status: PlatformAssignmentStatus;
  readonly statusLabel: string;
  readonly assignedLabel: string;
}

export const PLATFORM_CLIENT_ASSIGNMENTS: readonly PlatformClientAssignmentView[] = [
  {
    referenceCode: "ASG-0031",
    agencyOrgName: "示例代理商甲",
    clientOrgName: "示例客户企业",
    status: "ACTIVE",
    statusLabel: "生效中",
    assignedLabel: "分配于 2026-05-12",
  },
  {
    referenceCode: "ASG-0032",
    agencyOrgName: "示例代理商甲",
    clientOrgName: "示例制造企业",
    status: "ACTIVE",
    statusLabel: "生效中",
    assignedLabel: "分配于 2026-06-01",
  },
  {
    referenceCode: "ASG-0033",
    agencyOrgName: "示例代理商乙",
    clientOrgName: "示例零售企业（历史客户）",
    status: "REVOKED",
    statusLabel: "已撤销",
    assignedLabel: "分配已于 2026-04-20 撤销",
  },
] as const;

// ---------------------------------------------------------------------------
// 邀请 (invitations) - platform-wide invitation list/status view.
// ---------------------------------------------------------------------------

export type InvitationStatus = "PENDING" | "ACCEPTED" | "EXPIRED" | "REVOKED";

export interface InvitationView {
  readonly referenceCode: string;
  readonly orgName: string;
  readonly roleLabel: string;
  readonly status: InvitationStatus;
  readonly statusLabel: string;
  readonly invitedLabel: string;
}

export const INVITATIONS: readonly InvitationView[] = [
  {
    referenceCode: "INV-0101",
    orgName: "示例代理商甲",
    roleLabel: "代理商操作员",
    status: "PENDING",
    statusLabel: "待接受",
    invitedLabel: "邀请于 2026-07-15",
  },
  {
    referenceCode: "INV-0102",
    orgName: "示例客户企业",
    roleLabel: "客户管理员",
    status: "ACCEPTED",
    statusLabel: "已接受",
    invitedLabel: "邀请于 2026-06-28",
  },
  {
    referenceCode: "INV-0103",
    orgName: "示例制造企业",
    roleLabel: "客户成员",
    status: "EXPIRED",
    statusLabel: "已过期",
    invitedLabel: "邀请于 2026-05-01",
  },
  {
    referenceCode: "INV-0104",
    orgName: "示例代理商乙",
    roleLabel: "代理商负责人",
    status: "REVOKED",
    statusLabel: "已撤销",
    invitedLabel: "邀请于 2026-04-10",
  },
] as const;

// ---------------------------------------------------------------------------
// 账户审计 (account audit) - closely mirrors the REAL recovered evidence:
// recovered/partial-source/00040000000C9C6422CCAB4F-page.tsx (tenancyRepository.listAudit(),
// rendered as a 时间/动作/目标/操作者 table with actorUserId.slice(0,8)). The fixture
// below models a UUID-shaped actorUserId to match that recovered field's real shape, but
// only ever exposes the truncated 8-character prefix through actorDisplay - the full
// actorUserId is not part of the display-string surface.
// ---------------------------------------------------------------------------

export interface AuditEventView {
  readonly id: string;
  readonly timeLabel: string;
  readonly action: string;
  readonly targetLabel: string;
  /** Full actor id, matching the recovered evidence's real field shape. Never rendered raw. */
  readonly actorUserId: string;
}

export const AUDIT_EVENTS: readonly AuditEventView[] = [
  {
    id: "AUD-2001",
    timeLabel: "2026-07-17 09:14",
    action: "组织创建",
    targetLabel: "示例制造企业",
    actorUserId: "3f9a1c2b-7e41-4d8a-9b2f-6a0c1d5e8f21",
  },
  {
    id: "AUD-2002",
    timeLabel: "2026-07-17 10:02",
    action: "客户分配授予",
    targetLabel: "示例代理商甲 → 示例制造企业",
    actorUserId: "8b2d4e6f-1a3c-4f9d-8e7b-2c5a9f0d3b64",
  },
  {
    id: "AUD-2003",
    timeLabel: "2026-07-17 11:47",
    action: "邀请撤销",
    targetLabel: "示例代理商乙",
    actorUserId: "3f9a1c2b-7e41-4d8a-9b2f-6a0c1d5e8f21",
  },
  {
    id: "AUD-2004",
    timeLabel: "2026-07-18 08:30",
    action: "登录",
    targetLabel: "-",
    actorUserId: "c1e7f2a9-5b6d-4a1c-8f3e-9d0b7c4a2e18",
  },
] as const;

/** Display-only actor prefix, mirroring the recovered `actorUserId.slice(0,8)` convention. */
export function actorDisplay(event: AuditEventView): string {
  return event.actorUserId.slice(0, 8);
}

// ---------------------------------------------------------------------------
// 执行记录 (execution records) - minimal, opaque list view only: id + status + timestamp.
// Deliberately does NOT model provider calls, prompts, or any detailed execution schema -
// presentation only, per this checkpoint's scope.
// ---------------------------------------------------------------------------

export interface ExecutionRecordView {
  readonly referenceCode: string;
  readonly statusLabel: string;
  readonly timestampLabel: string;
}

export const EXECUTION_RECORDS: readonly ExecutionRecordView[] = [
  { referenceCode: "EXE-0501", statusLabel: "已完成", timestampLabel: "2026-07-17 09:20" },
  { referenceCode: "EXE-0502", statusLabel: "进行中", timestampLabel: "2026-07-18 07:05" },
  { referenceCode: "EXE-0503", statusLabel: "失败", timestampLabel: "2026-07-16 22:41" },
] as const;

// ---------------------------------------------------------------------------
// Evidence 审计 (evidence audit) - minimal list view, presentation only.
// ---------------------------------------------------------------------------

export interface EvidenceAuditEventView {
  readonly referenceCode: string;
  readonly actionLabel: string;
  readonly targetLabel: string;
  readonly timestampLabel: string;
}

export const EVIDENCE_AUDIT_EVENTS: readonly EvidenceAuditEventView[] = [
  {
    referenceCode: "EVA-0301",
    actionLabel: "证据条目校验",
    targetLabel: "示例客户项目",
    timestampLabel: "2026-07-17 09:31",
  },
  {
    referenceCode: "EVA-0302",
    actionLabel: "证据条目归档",
    targetLabel: "制造行业知识库项目",
    timestampLabel: "2026-07-16 15:12",
  },
] as const;

// ---------------------------------------------------------------------------
// 审核队列 (review queue) - platform-wide view, presentation only, no real
// approve/reject wiring (same rule as src/app/agency/_fixtures.ts REVIEW_QUEUE_ITEMS).
// ---------------------------------------------------------------------------

export interface PlatformReviewQueueItemView {
  readonly referenceCode: string;
  readonly title: string;
  readonly orgName: string;
  readonly submittedLabel: string;
  readonly statusLabel: string;
}

export const PLATFORM_REVIEW_QUEUE_ITEMS: readonly PlatformReviewQueueItemView[] = [
  {
    referenceCode: "RVW-0021",
    title: "示例客户项目内容审核",
    orgName: "示例客户企业",
    submittedLabel: "2026-07-16 提交",
    statusLabel: "待审核",
  },
  {
    referenceCode: "RVW-0022",
    title: "制造行业知识库条目审核",
    orgName: "示例制造企业",
    submittedLabel: "2026-07-17 提交",
    statusLabel: "待审核",
  },
  {
    referenceCode: "RVW-0023",
    title: "零售行业历史内容复核",
    orgName: "示例零售企业（历史客户）",
    submittedLabel: "2026-07-14 提交",
    statusLabel: "已驳回",
  },
] as const;

export const PLATFORM_REVIEW_QUEUE_NOTICE =
  "占位数据 - 平台级审核队列展示，不执行任何真实的通过/驳回操作，无表单提交。";

// ---------------------------------------------------------------------------
// 模型与用量 (models & usage) - IMPORTANT: no real AI/model provider or vendor name may
// ever appear in this section's labels. Model identities are genericized as "模型 A" /
// "模型 B" with an internal reference code, matching the compliance rule already enforced
// on the client workspace (tests/client-workspace-copy.test.ts PROVIDER_VENDOR_NAMES).
// ---------------------------------------------------------------------------

export interface ModelUsageSummaryView {
  readonly referenceCode: string;
  readonly modelLabel: string;
  readonly usageLabel: string;
  readonly statusLabel: string;
}

export const MODEL_USAGE_SUMMARIES: readonly ModelUsageSummaryView[] = [
  {
    referenceCode: "MDL-A",
    modelLabel: "模型 A",
    usageLabel: "本月调用次数：1,204",
    statusLabel: "已启用",
  },
  {
    referenceCode: "MDL-B",
    modelLabel: "模型 B",
    usageLabel: "本月调用次数：318",
    statusLabel: "已启用",
  },
  {
    referenceCode: "MDL-C",
    modelLabel: "模型 C",
    usageLabel: "本月调用次数：0",
    statusLabel: "已停用",
  },
] as const;

export const MODEL_USAGE_NOTICE = "占位数据 - 用量汇总展示，模型名称已泛化为内部参考代号，不包含任何具体服务商名称。";

// ---------------------------------------------------------------------------
// Core Rule Pack / Vertical Pack (规则包) - minimal list view, presentation only.
// ---------------------------------------------------------------------------

export interface RulePackView {
  readonly referenceCode: string;
  readonly name: string;
  readonly typeLabel: string;
  readonly versionLabel: string;
  readonly statusLabel: string;
}

export const RULE_PACKS: readonly RulePackView[] = [
  {
    referenceCode: "RPK-0001",
    name: "核心规则包",
    typeLabel: "核心",
    versionLabel: "v1.3",
    statusLabel: "已启用",
  },
  {
    referenceCode: "RPK-0004",
    name: "制造业垂直规则包",
    typeLabel: "垂直",
    versionLabel: "v1.0",
    statusLabel: "已启用",
  },
  {
    referenceCode: "RPK-0009",
    name: "零售业垂直规则包",
    typeLabel: "垂直",
    versionLabel: "v0.9",
    statusLabel: "草拟中",
  },
] as const;

// ---------------------------------------------------------------------------
// 发布连接器 (publisher connectors) - per SYSTEM_INVARIANTS_V1 "Publication" ("External
// publisher integrations (e.g. a WeChatSync-style bridge) are future, opt-in, explicit -
// never wired in as a default path"), every connector fixture below MUST have
// enabled: false and connectedCount: 0. This list must never contain a connector shown
// as enabled/connected by default.
// ---------------------------------------------------------------------------

export interface PublisherConnectorView {
  readonly referenceCode: string;
  readonly name: string;
  readonly summary: string;
  readonly enabled: false;
  readonly connectedCount: 0;
}

export const PUBLISHER_CONNECTORS: readonly PublisherConnectorView[] = [
  {
    referenceCode: "PUB-0001",
    name: "公众号同步桥接（示例）",
    summary: "面向未来的可选外部发布桥接，需运营方在授权后手动接入，默认未启用、未连接。",
    enabled: false,
    connectedCount: 0,
  },
  {
    referenceCode: "PUB-0002",
    name: "通用 RSS 输出桥接（示例）",
    summary: "面向未来的可选外部发布桥接，默认未启用、未连接，不作为主要分发机制。",
    enabled: false,
    connectedCount: 0,
  },
] as const;

export const PUBLISHER_CONNECTORS_NOTICE =
  "占位数据 - 当前已连接的发布连接器数量为 0。发布连接器是面向未来的可选集成（例如公众号同步桥接一类），需要人工在授权后显式接入，绝不作为默认启用或自动发布路径。";

// ---------------------------------------------------------------------------
// 系统健康 (系统健康 / system health) - minimal status/health placeholder view.
// ---------------------------------------------------------------------------

export interface SystemHealthComponentView {
  readonly referenceCode: string;
  readonly componentLabel: string;
  readonly statusLabel: string;
  readonly checkedLabel: string;
}

export const SYSTEM_HEALTH_COMPONENTS: readonly SystemHealthComponentView[] = [
  { referenceCode: "SYS-0001", componentLabel: "应用服务", statusLabel: "正常", checkedLabel: "2026-07-18 08:00" },
  { referenceCode: "SYS-0002", componentLabel: "数据存储", statusLabel: "正常", checkedLabel: "2026-07-18 08:00" },
  { referenceCode: "SYS-0003", componentLabel: "后台任务队列", statusLabel: "降级", checkedLabel: "2026-07-18 07:45" },
] as const;

// ---------------------------------------------------------------------------
// Collector for the compliance test (tests/ops-workspace-copy.test.ts).
// ---------------------------------------------------------------------------

/**
 * Collects every human-visible display string this checkpoint renders, so the compliance
 * test can pattern-check them without needing a full render pipeline. Deliberately does
 * NOT include the full, untruncated AuditEventView.actorUserId - only actorDisplay()'s
 * 8-character prefix, matching the recovered evidence's rendered surface.
 */
export function collectOpsVisibleStrings(): string[] {
  const strings: string[] = [PLATFORM_REVIEW_QUEUE_NOTICE, MODEL_USAGE_NOTICE, PUBLISHER_CONNECTORS_NOTICE];

  for (const org of ORGANIZATIONS) {
    strings.push(org.referenceCode, org.name, org.typeLabel, org.statusLabel, org.createdLabel);
  }

  for (const a of PLATFORM_CLIENT_ASSIGNMENTS) {
    strings.push(a.referenceCode, a.agencyOrgName, a.clientOrgName, a.statusLabel, a.assignedLabel);
  }

  for (const inv of INVITATIONS) {
    strings.push(inv.referenceCode, inv.orgName, inv.roleLabel, inv.statusLabel, inv.invitedLabel);
  }

  for (const event of AUDIT_EVENTS) {
    strings.push(event.id, event.timeLabel, event.action, event.targetLabel, actorDisplay(event));
  }

  for (const exe of EXECUTION_RECORDS) {
    strings.push(exe.referenceCode, exe.statusLabel, exe.timestampLabel);
  }

  for (const ev of EVIDENCE_AUDIT_EVENTS) {
    strings.push(ev.referenceCode, ev.actionLabel, ev.targetLabel, ev.timestampLabel);
  }

  for (const item of PLATFORM_REVIEW_QUEUE_ITEMS) {
    strings.push(item.referenceCode, item.title, item.orgName, item.submittedLabel, item.statusLabel);
  }

  for (const m of MODEL_USAGE_SUMMARIES) {
    strings.push(m.referenceCode, m.modelLabel, m.usageLabel, m.statusLabel);
  }

  for (const rp of RULE_PACKS) {
    strings.push(rp.referenceCode, rp.name, rp.typeLabel, rp.versionLabel, rp.statusLabel);
  }

  for (const conn of PUBLISHER_CONNECTORS) {
    strings.push(conn.referenceCode, conn.name, conn.summary);
  }

  for (const h of SYSTEM_HEALTH_COMPONENTS) {
    strings.push(h.referenceCode, h.componentLabel, h.statusLabel, h.checkedLabel);
  }

  return strings;
}

/** Collects only the strings rendered on the 模型与用量 page, for the targeted vendor-name check. */
export function collectModelUsageVisibleStrings(): string[] {
  const strings: string[] = [MODEL_USAGE_NOTICE];
  for (const m of MODEL_USAGE_SUMMARIES) {
    strings.push(m.referenceCode, m.modelLabel, m.usageLabel, m.statusLabel);
  }
  return strings;
}
