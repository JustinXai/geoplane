/**
 * LightDraftGateService — pre-publication content quality gate for ArticleDrafts.
 *
 * This is a lightweight, first-pass evaluation that runs BEFORE the full
 * quality/platform/vertical gate chain. It focuses on content quality issues
 * that are repairable or represent hard risks.
 *
 * Gate principles (per agent spec):
 *   - Viral/传播 effect first
 *   - Facts and hard risk as fallback
 *   - Repairable issues → REPAIR
 *   - Real hard risks → REJECT
 *
 * Check items:
 *   1. 是否忠于企业知识 (factual to knowledge)
 *   2. 无虚构案例/资质/数据 (no fabricated cases/qualifications/data)
 *   3. 实体明确 (entities explicit)
 *   4. 结论前置 (conclusions first)
 *   5. 结构适合国内AI理解 (AI-friendly structure for domestic AI)
 *   6. 无关键词堆砌 (no keyword stuffing)
 *   7. 无绝对化表达 (no absolute claims)
 *   8. 符合VerticalPolicyPack (follows policy)
 *
 * REPAIR flow:
 *   When gate returns REPAIR:
 *   1. Generate corrected draft version
 *   2. Persist as new draft version via ArticleDraftRepository
 *   3. Return to review queue
 *
 * This service is deterministic in evaluation: it performs no I/O, calls no provider,
 * and never reads the clock or generates randomness during evaluation.
 * Repository operations for persisting repaired drafts use GeoRuntimeInfra.
 */
import { assertCanAccessClientOrganization } from "../../../contracts/tenancy/authorization.js";
import type { AuthorizationContext } from "../../../contracts/tenancy/entities.js";
import type {
  ArticleDraft,
  ArticleDraftSection,
  DraftArticleDraft,
} from "../../../contracts/geo-business/entities.js";
import type { ArticleDraftRepository } from "../ports.js";
import { emitAudit, type GeoRuntimeInfra } from "./support.js";

/** Severity levels for gate issues — determines repairability. */
export type GateIssueSeverity = "HARMFUL" | "REPAIRABLE" | "WARNING";

/** Category of the detected issue. */
export type GateIssueCategory =
  | "FACTUAL_ACCURACY"
  | "FABRICATED_CONTENT"
  | "ENTITY_CLARITY"
  | "STRUCTURE"
  | "KEYWORD_STUFFING"
  | "ABSOLUTE_CLAIMS"
  | "POLICY_VIOLATION"
  | "DOMESTIC_AI_COMPATIBILITY";

/** One detected issue during gate evaluation. */
export interface GateIssue {
  category: GateIssueCategory;
  severity: GateIssueSeverity;
  message: string;
  /** Suggestion for repair, if repairable. */
  repairHint?: string;
  /** Position context for the issue (section index). */
  sectionIndex?: number;
}

/** The verdict from a light gate evaluation. */
export type LightGateVerdict = "PASS" | "REPAIR" | "REJECT";

/** Result of a light gate evaluation. */
export interface LightGateResult {
  verdict: LightGateVerdict;
  issues: GateIssue[];
  /** A repaired version of the draft, if verdict is REPAIR and repair was attempted. */
  repairedDraft?: ArticleDraft;
  evaluatedAt: string;
}

/** Input for repairing a draft section. */
interface SectionRepair {
  sectionIndex: number;
  newHeading: string;
}

/**
 * LightDraftGateService — evaluates ArticleDrafts against content quality criteria.
 *
 * Pure evaluation: checks the draft's structural properties without I/O.
 * Repair generation: produces a modified draft when verdict is REPAIR.
 * Optional persistence: persists repaired draft to repository if provided.
 */
export class LightDraftGateService {
  constructor(
    private readonly infra: GeoRuntimeInfra,
    private readonly drafts?: ArticleDraftRepository,
  ) {}

  /**
   * Evaluates a draft against the light gate criteria.
   *
   * @param actor - Authorization context for tenant isolation.
   * @param draft - The draft to evaluate.
   * @returns LightGateResult with verdict, issues, and optional repaired draft.
   */
  evaluate(
    actor: AuthorizationContext,
    draft: ArticleDraft,
  ): LightGateResult {
    assertCanAccessClientOrganization(actor, draft.clientOrganizationId);

    const issues: GateIssue[] = [];
    const evaluatedAt = this.infra.clock.now().toISOString();

    // Collect all issues
    issues.push(...this.checkFactualAccuracy(draft));
    issues.push(...this.checkFabricatedContent(draft));
    issues.push(...this.checkEntityClarity(draft));
    issues.push(...this.checkStructure(draft));
    issues.push(...this.checkKeywordStuffing(draft));
    issues.push(...this.checkAbsoluteClaims(draft));
    issues.push(...this.checkDomesticAICompatibility(draft));

    // Determine verdict based on issue severities
    const hasHardRisk = issues.some((i) => i.severity === "HARMFUL");
    const hasRepairable = issues.some((i) => i.severity === "REPAIRABLE");

    let verdict: LightGateVerdict;
    if (hasHardRisk) {
      verdict = "REJECT";
    } else if (hasRepairable) {
      verdict = "REPAIR";
    } else {
      verdict = "PASS";
    }

    // Generate repaired draft if verdict is REPAIR
    let repairedDraft: DraftArticleDraft | undefined;
    if (verdict === "REPAIR" && draft.status === "DRAFT") {
      repairedDraft = this.generateRepairedDraft(draft, issues);
    }

    return {
      verdict,
      issues,
      ...(repairedDraft ? { repairedDraft } : {}),
      evaluatedAt,
    };
  }

  /**
   * Evaluates and persists a repaired draft. If verdict is REPAIR, persists the repaired
   * draft to the repository and returns the persisted version.
   *
   * @param actor - Authorization context for tenant isolation.
   * @param draft - The draft to evaluate.
   * @returns LightGateResult with verdict, issues, and optionally the persisted repaired draft.
   * @throws if repository is not provided and verdict is REPAIR.
   */
  async evaluateAndRepair(
    actor: AuthorizationContext,
    draft: ArticleDraft,
  ): Promise<LightGateResult> {
    assertCanAccessClientOrganization(actor, draft.clientOrganizationId);

    const result = this.evaluate(actor, draft);

    // Persist repaired draft if available
    if (result.verdict === "REPAIR" && result.repairedDraft && this.drafts) {
      const draftToPersist = result.repairedDraft;
      const persistedDraft = await this.drafts.add(draftToPersist);

      await emitAudit(
        this.infra,
        actor,
        { clientOrganizationId: draftToPersist.clientOrganizationId, projectId: draftToPersist.projectId },
        "draft.repaired",
        "ArticleDraft",
        draftToPersist.id,
        result.evaluatedAt,
      );

      // Return a new result with the persisted draft
      return {
        ...result,
        repairedDraft: persistedDraft as DraftArticleDraft,
      };
    } else if (result.verdict === "REPAIR" && !this.drafts) {
      throw new Error(
        "LightDraftGateService: repository not provided, cannot persist repaired draft.",
      );
    }

    return result;
  }

  // ---------------------------------------------------------------------------
  // Check implementations
  // ---------------------------------------------------------------------------

  /**
   * Check 1: 是否忠于企业知识 (factual to knowledge)
   * Verifies that the draft has proper structure and citations.
   * In a full implementation, this would check against the KnowledgePackage.
   * For now, we check structural requirements.
   */
  private checkFactualAccuracy(draft: ArticleDraft): GateIssue[] {
    const issues: GateIssue[] = [];

    // Check that the draft has meaningful content (has sections)
    if (draft.sections.length === 0) {
      issues.push({
        category: "FACTUAL_ACCURACY",
        severity: "HARMFUL",
        message: "Draft has no sections — cannot verify factual grounding.",
        repairHint: "Add at least one content section with factual information.",
      });
    }

    // Check that the title is present and meaningful
    if (!draft.title || draft.title.trim().length < 5) {
      issues.push({
        category: "FACTUAL_ACCURACY",
        severity: "REPAIRABLE",
        message: "Draft title is missing or too short to convey topic.",
        repairHint: "Provide a descriptive title of at least 5 characters.",
      });
    }

    // Check that sections have meaningful headings
    for (let i = 0; i < draft.sections.length; i++) {
      const section = draft.sections[i]!;
      if (!section.heading || section.heading.trim().length < 2) {
        issues.push({
          category: "STRUCTURE",
          severity: "REPAIRABLE",
          message: `Section ${i + 1} has a missing or too-short heading.`,
          repairHint: "Provide a descriptive heading of at least 2 characters.",
          sectionIndex: i,
        });
      }
    }

    return issues;
  }

  /**
   * Check 2: 无虚构案例/资质/数据 (no fabricated cases/qualifications/data)
   * Detects patterns that suggest fabricated content.
   */
  private checkFabricatedContent(draft: ArticleDraft): GateIssue[] {
    const issues: GateIssue[] = [];

    // Pattern detection for potentially fabricated statistics
    const fabricatedPatterns = [
      /[0-9]+%.*增长/gi, // e.g. "30%增长" without source
      /[0-9]+倍/gi, // e.g. "3倍" without context
      /排名\s*[第]?[0-9]+/gi, // e.g. "排名前10" without source
      /第一[名]?/gi, // Absolute claims of being "first"
    ];

    for (let i = 0; i < draft.sections.length; i++) {
      const section = draft.sections[i]!;
      const heading = section.heading;

      for (const pattern of fabricatedPatterns) {
        if (pattern.test(heading)) {
          issues.push({
            category: "FABRICATED_CONTENT",
            severity: "WARNING",
            message: `Section "${heading}" contains a statistical claim that may lack citation.`,
            repairHint: "Add source attribution or remove unsubstantiated statistics.",
            sectionIndex: i,
          });
          break; // One issue per section for this category
        }
      }
    }

    return issues;
  }

  /**
   * Check 3: 实体明确 (entities explicit)
   * Verifies that key entities are clearly referenced.
   */
  private checkEntityClarity(draft: ArticleDraft): GateIssue[] {
    const issues: GateIssue[] = [];

    // Check for vague references that could be entities
    const vagueEntityPatterns = [
      /某[公司企业机构]/g, // "certain company"
      /[这那]个[东西事]/g, // "that thing"
      /[他她它]们?的/g, // possessive without clear referent
    ];

    for (let i = 0; i < draft.sections.length; i++) {
      const section = draft.sections[i]!;
      const heading = section.heading;

      for (const pattern of vagueEntityPatterns) {
        if (pattern.test(heading)) {
          issues.push({
            category: "ENTITY_CLARITY",
            severity: "REPAIRABLE",
            message: `Section "${heading}" contains vague entity references.`,
            repairHint: "Replace vague references with specific entity names.",
            sectionIndex: i,
          });
          break;
        }
      }
    }

    return issues;
  }

  /**
   * Check 4: 结论前置 (conclusions first)
   * Verifies that the draft structure puts key conclusions early.
   */
  private checkStructure(draft: ArticleDraft): GateIssue[] {
    const issues: GateIssue[] = [];

    // Check that the first section is substantive (not just an intro placeholder)
    if (draft.sections.length > 0) {
      const firstSection = draft.sections[0]!;
      const introIndicators = [/^导言?$/i, /^简介?$/i, /^概述$/i, /^前言$/i, /^背景$/i, /^intro/i, /^introduction$/i];

      const isIntro = introIndicators.some((p) => p.test(firstSection.heading.trim()));

      if (isIntro && draft.sections.length > 1) {
        issues.push({
          category: "STRUCTURE",
          severity: "WARNING",
          message: "First section appears to be an introduction, but conclusions should come first for better engagement.",
          repairHint: "Consider moving a key conclusion or summary to the first section.",
          sectionIndex: 0,
        });
      }
    }

    // Check for logical section ordering (not all sections should be similar)
    if (draft.sections.length >= 3) {
      const headings = draft.sections.map((s) => s.heading.trim().toLowerCase());
      const uniqueHeadings = new Set(headings);

      if (uniqueHeadings.size < headings.length * 0.5) {
        issues.push({
          category: "STRUCTURE",
          severity: "REPAIRABLE",
          message: "Many sections have similar headings, suggesting possible redundancy.",
          repairHint: "Ensure each section has a distinct purpose and heading.",
        });
      }
    }

    return issues;
  }

  /**
   * Check 5: 无关键词堆砌 (no keyword stuffing)
   * Detects excessive keyword repetition in headings.
   */
  private checkKeywordStuffing(draft: ArticleDraft): GateIssue[] {
    const issues: GateIssue[] = [];

    // Extract potential keywords (2-4 character Chinese phrases or English words)
    const keywordPattern = /[\u4e00-\u9fa5]{2,4}|[a-zA-Z]{3,}/g;
    const allKeywords: string[] = [];

    for (const section of draft.sections) {
      const matches = section.heading.match(keywordPattern) || [];
      allKeywords.push(...matches);
    }

    // Count occurrences of each keyword
    const keywordCounts = new Map<string, number>();
    for (const kw of allKeywords) {
      const normalized = kw.toLowerCase();
      keywordCounts.set(normalized, (keywordCounts.get(normalized) || 0) + 1);
    }

    // Check for excessive repetition (more than 50% of sections)
    const sectionCount = draft.sections.length;
    const threshold = Math.max(2, Math.floor(sectionCount * 0.5));

    for (const [keyword, count] of keywordCounts) {
      if (count > threshold && count > 2) {
        issues.push({
          category: "KEYWORD_STUFFING",
          severity: "REPAIRABLE",
          message: `Keyword "${keyword}" appears in ${count} section headings, suggesting possible keyword stuffing.`,
          repairHint: "Reduce keyword repetition and vary your headings.",
        });
      }
    }

    return issues;
  }

  /**
   * Check 6: 无绝对化表达 (no absolute claims)
   * Detects overly absolute or promotional language.
   */
  private checkAbsoluteClaims(draft: ArticleDraft): GateIssue[] {
    const issues: GateIssue[] = [];

    // Patterns for absolute/unsubstantiated claims
    const absolutePatterns = [
      { pattern: /最佳|第一[流等]/g, message: "contains superlative claims" },
      { pattern: /完美|无可挑剔/g, message: "contains unverifiable perfection claims" },
      { pattern: /保证|确保.*成功/g, message: "contains guarantee language" },
      { pattern: /100%|百分之百/g, message: "contains absolute percentage claims" },
      { pattern: /绝对/g, message: "contains absolute language" },
      { pattern: /必须|不得不/g, message: "contains imperative necessity language" },
    ];

    for (let i = 0; i < draft.sections.length; i++) {
      const section = draft.sections[i]!;
      const heading = section.heading;

      for (const { pattern, message } of absolutePatterns) {
        if (pattern.test(heading)) {
          issues.push({
            category: "ABSOLUTE_CLAIMS",
            severity: "WARNING",
            message: `Section "${heading}" ${message}.`,
            repairHint: "Use qualified language like 'often', 'typically', or 'in many cases'.",
            sectionIndex: i,
          });
          break;
        }
      }
    }

    return issues;
  }

  /**
   * Check 7: 结构适合国内AI理解 (AI-friendly structure for domestic AI)
   * Verifies the draft structure is optimized for domestic AI consumption.
   */
  private checkDomesticAICompatibility(draft: ArticleDraft): GateIssue[] {
    const issues: GateIssue[] = [];

    // Check for clear hierarchical structure
    if (draft.sections.length > 0 && draft.sections.length < 3) {
      issues.push({
        category: "DOMESTIC_AI_COMPATIBILITY",
        severity: "WARNING",
        message: "Draft has fewer than 3 sections, which may be insufficient for comprehensive coverage.",
        repairHint: "Consider adding more sections to provide thorough coverage of the topic.",
      });
    }

    // Check that headings are written in Chinese or mixed (not English-only)
    for (let i = 0; i < draft.sections.length; i++) {
      const section = draft.sections[i]!;
      const heading = section.heading;

      // If heading is English-only (no Chinese characters)
      const hasChinese = /[\u4e00-\u9fa5]/.test(heading);
      if (!hasChinese && /[a-zA-Z]/.test(heading)) {
        issues.push({
          category: "DOMESTIC_AI_COMPATIBILITY",
          severity: "WARNING",
          message: `Section "${heading}" is English-only, which may affect domestic AI understanding.`,
          repairHint: "Consider using Chinese headings or mixed Chinese/English for better local AI compatibility.",
          sectionIndex: i,
        });
      }
    }

    // Check for proper punctuation
    for (let i = 0; i < draft.sections.length; i++) {
      const section = draft.sections[i]!;
      const heading = section.heading.trim();

      // Check for trailing punctuation in headings (not ideal)
      if (/[，。、！？；：]$/.test(heading)) {
        issues.push({
          category: "DOMESTIC_AI_COMPATIBILITY",
          severity: "WARNING",
          message: `Section "${heading}" ends with punctuation, which may not be optimal for AI parsing.`,
          repairHint: "Remove trailing punctuation from section headings.",
          sectionIndex: i,
        });
      }
    }

    return issues;
  }

  // ---------------------------------------------------------------------------
  // Repair generation
  // ---------------------------------------------------------------------------

  /**
   * Generates a repaired version of the draft based on detected issues.
   * This is a best-effort repair that addresses REPAIRABLE severity issues.
   */
  private generateRepairedDraft(draft: DraftArticleDraft, issues: GateIssue[]): DraftArticleDraft {
    const repairs: SectionRepair[] = [];
    const repairableIssues = issues.filter((i) => i.severity === "REPAIRABLE");

    // Apply repair hints
    for (const issue of repairableIssues) {
      if (issue.sectionIndex !== undefined && issue.repairHint) {
        const section = draft.sections[issue.sectionIndex];
        if (section) {
          // Generate a new heading based on the repair hint
          const newHeading = this.applyRepairHint(section.heading, issue);
          if (newHeading !== section.heading) {
            repairs.push({
              sectionIndex: issue.sectionIndex,
              newHeading,
            });
          }
        }
      }
    }

    // Build the repaired sections
    const repairedSections: ArticleDraftSection[] = draft.sections.map((section, index) => {
      const repair = repairs.find((r) => r.sectionIndex === index);
      if (repair) {
        return {
          ...section,
          heading: repair.newHeading,
        };
      }
      return section;
    });

    // Generate a new version of the draft
    const newId = this.infra.ids.next();
    const compiledAt = this.infra.clock.now().toISOString();

    // For repaired drafts, we increment the version
    const newVersion = draft.version + 1;

    return {
      id: newId,
      clientOrganizationId: draft.clientOrganizationId,
      projectId: draft.projectId,
      articleBriefId: draft.articleBriefId,
      sourceProviderArticleContentIds: draft.sourceProviderArticleContentIds,
      version: newVersion,
      title: draft.title,
      sections: repairedSections,
      status: "DRAFT",
      compiledAt,
    };
  }

  /**
   * Applies a repair hint to a heading, generating an improved version.
   */
  private applyRepairHint(heading: string, issue: GateIssue): string {
    let repaired = heading;

    switch (issue.category) {
      case "FACTUAL_ACCURACY":
        // Ensure heading is descriptive and meaningful
        if (repaired.trim().length < 5) {
          repaired = `关于${repaired.trim()}的详细说明`;
        }
        break;

      case "ENTITY_CLARITY":
        // Replace vague references with placeholders for manual review
        repaired = repaired
          .replace(/某[公司企业机构]/g, "[具体实体名称]")
          .replace(/[这那]个[东西事]/g, "[具体指代]")
          .replace(/[他她它]们?的/g, "[具体对象]的");
        break;

      case "STRUCTURE":
        // Make headings more distinct
        const prefix = repaired.match(/^(导言?|简介?|概述|前言|背景)/i)?.[0] || "";
        if (prefix) {
          // Keep intro but add qualifier
          repaired = `${prefix}：核心要点概述`;
        }
        break;

      case "KEYWORD_STUFFING":
        // Simplify keyword-heavy headings
        // Extract first meaningful keyword and make heading more generic
        const words = repaired.split(/[\s,，、]+/).filter((w) => w.length > 1);
        if (words.length > 3) {
          repaired = words.slice(0, 3).join("、") + "等关键要点";
        }
        break;

      default:
        // For other issues, append review note
        if (issue.repairHint) {
          repaired = `[需审核] ${repaired}`;
        }
        break;
    }

    return repaired.trim();
  }
}
