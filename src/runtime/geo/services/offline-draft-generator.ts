/**
 * OfflineDraftGenerator — creates ArticleDraft from ArticleBrief when the provider runtime is OFF.
 *
 * KEY INSIGHT: `compileArticleDraft` is a pure function that only needs `ProviderArticleContent`
 * records (opaque pointers) as input. It does NOT need actual AI-generated content — the draft
 * sections are derived directly from the brief's outline. Therefore, when the provider is OFF,
 * we can create a valid draft by:
 *
 *   1. Creating a `ProviderArticleContent` record with a special offline envelope ID
 *   2. Calling `compileDraft` which delegates to `compileArticleDraft`
 *
 * This is structurally identical to what happens when the provider is ON, but:
 * - No real LLM API call is made
 * - No AI-generated content is used
 * - The draft sections come from the brief's outline, not from AI
 *
 * GEO AI-FRIENDLY CONTENT STRUCTURE:
 * - Entities are explicit (品牌, 产品, 场景, 地域)
 * - Conclusions are first (结论前置)
 * - One section per main question from the outline
 * - Clear Q&A structure
 * - No keyword stuffing
 * - Key facts are extractable
 *
 * Provider Calls = 0, structurally. This adapter has NO network import of any kind.
 */
import { assertCanAccessClientOrganization } from "../../../contracts/tenancy/authorization.js";
import type { AuthorizationContext } from "../../../contracts/tenancy/entities.js";
import type { ArticleBrief, DraftArticleDraft, ProviderArticleContent } from "../../../contracts/geo-business/entities.js";
import type {
  ArticleDraftRepository,
  ProviderArticleContentRepository,
} from "../ports.js";
import { emitAudit, type GeoRuntimeInfra } from "./support.js";

/**
 * Input for offline draft generation.
 * Takes an ArticleBrief that was already created from an OpportunityFamily.
 */
export interface GenerateOfflineDraftInput {
  /** The brief to generate a draft from. */
  readonly brief: ArticleBrief;
  /**
   * Optional label for the offline envelope. Defaults to "offline".
   * Used to distinguish multiple offline drafts of the same brief.
   */
  readonly offlineEnvelopeLabel?: string;
}

/**
 * Result of offline draft generation.
 */
export interface GenerateOfflineDraftResult {
  /** The ingested provider content record (offline envelope). */
  readonly providerContent: ProviderArticleContent;
  /** The compiled draft article. */
  readonly draft: DraftArticleDraft;
}

export class OfflineDraftGenerator {
  constructor(
    private readonly providerContents: ProviderArticleContentRepository,
    private readonly drafts: ArticleDraftRepository,
    private readonly infra: GeoRuntimeInfra,
  ) {}

  /**
   * Generate an ArticleDraft from an ArticleBrief when the provider is OFF.
   *
   * This method:
   * 1. Creates a `ProviderArticleContent` record with an offline envelope ID
   * 2. Calls `compileDraft` which uses the frozen `compileArticleDraft` pure function
   * 3. Returns both the provider content record and the compiled draft
   *
   * @throws if `brief` is not accessible by the actor (tenant isolation)
   * @throws if `brief.planningContext` is missing
   */
  async generateDraft(
    actor: AuthorizationContext,
    input: GenerateOfflineDraftInput,
  ): Promise<GenerateOfflineDraftResult> {
    assertCanAccessClientOrganization(actor, input.brief.clientOrganizationId);

    // Step 1: Ingest offline provider content.
    // The envelope ID is deterministic based on brief ID and optional label.
    const label = input.offlineEnvelopeLabel ?? "offline";
    const envelopeId = `offline_envelope_${input.brief.id}_${label}_${Date.now()}`;
    const receivedAt = this.infra.clock.now().toISOString();

    const providerContent: ProviderArticleContent = {
      id: this.infra.ids.next(),
      clientOrganizationId: input.brief.clientOrganizationId,
      projectId: input.brief.projectId,
      articleBriefId: input.brief.id,
      providerResponseEnvelopeId: envelopeId,
      receivedAt,
    };

    await this.providerContents.add(providerContent);
    await emitAudit(
      this.infra,
      actor,
      providerContent,
      "provider_article_content.ingested.offline",
      "ProviderArticleContent",
      providerContent.id,
      receivedAt,
    );

    // Step 2: Compile the draft using the frozen pure function.
    const existing = await this.drafts.listByArticleBrief(input.brief.id);
    const highest = existing.reduce(
      (max, draft) => (draft.version > max ? draft.version : max),
      0,
    );
    const version = highest + 1;
    const compiledAt = this.infra.clock.now().toISOString();

    // Import the pure compile function inline to avoid circular dependencies.
    const { compileArticleDraft } = await import(
      "../../../contracts/geo-business/entities.js"
    );

    const draft = compileArticleDraft(input.brief, [providerContent], {
      id: this.infra.ids.next(),
      version,
      compiledAt,
    });

    await this.drafts.add(draft);
    await emitAudit(
      this.infra,
      actor,
      draft,
      "article_draft.compiled.offline",
      "ArticleDraft",
      draft.id,
      compiledAt,
    );

    return { providerContent, draft };
  }
}
