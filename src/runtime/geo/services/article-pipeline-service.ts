/**
 * ArticlePipelineService — offline provider-content ingestion and draft
 * compilation (chain item 9, "Article compiler").
 *
 * Provider Calls = 0, structurally:
 *
 *  - `ingestProviderArticleContent` stores only an OPAQUE
 *    `providerResponseEnvelopeId` pointer to a raw provider envelope produced
 *    entirely out-of-band (an offline fixture in tests). It never calls a
 *    provider, and the frozen ProviderArticleContent type has no payload field
 *    to inline one into.
 *  - `compileDraft` delegates to the frozen, pure `compileArticleDraft`, which
 *    has no imports, no I/O, and no network of any kind. This service adds only
 *    version derivation, identity, and persistence around it.
 *
 * Versioning is append-only: each compile produces a NEW ArticleDraft with a
 * new id and an incremented `version` (monotonic per brief). An existing draft
 * is never mutated.
 */
import { assertCanAccessClientOrganization } from "../../../contracts/tenancy/authorization.js";
import type { AuthorizationContext } from "../../../contracts/tenancy/entities.js";
import {
  compileArticleDraft,
  type ArticleBrief,
  type DraftArticleDraft,
  type ProviderArticleContent,
} from "../../../contracts/geo-business/entities.js";
import type {
  ArticleDraftRepository,
  ProviderArticleContentRepository,
} from "../ports.js";
import { emitAudit, type GeoRuntimeInfra } from "./support.js";

export class ArticlePipelineService {
  constructor(
    private readonly providerContents: ProviderArticleContentRepository,
    private readonly drafts: ArticleDraftRepository,
    private readonly infra: GeoRuntimeInfra,
  ) {}

  /**
   * Ingest one already-produced provider envelope as data. NOT a provider call:
   * the envelope id is opaque and its content lives out-of-band. This is the
   * only way provider content enters the pipeline.
   */
  async ingestProviderArticleContent(
    actor: AuthorizationContext,
    brief: ArticleBrief,
    providerResponseEnvelopeId: string,
  ): Promise<ProviderArticleContent> {
    assertCanAccessClientOrganization(actor, brief.clientOrganizationId);
    const receivedAt = this.infra.clock.now().toISOString();
    const content: ProviderArticleContent = {
      id: this.infra.ids.next(),
      clientOrganizationId: brief.clientOrganizationId,
      projectId: brief.projectId,
      articleBriefId: brief.id,
      providerResponseEnvelopeId,
      receivedAt,
    };
    await this.providerContents.add(content);
    await emitAudit(
      this.infra,
      actor,
      content,
      "provider_article_content.ingested",
      "ProviderArticleContent",
      content.id,
      receivedAt,
    );
    return content;
  }

  /**
   * Compile a new DraftArticleDraft from a brief and its ingested provider
   * contents. Delegates the transformation entirely to the frozen pure
   * `compileArticleDraft`; the only non-pure parts are the injected version /
   * id / timestamp and persistence.
   */
  async compileDraft(
    actor: AuthorizationContext,
    brief: ArticleBrief,
    providerContents: ProviderArticleContent[],
  ): Promise<DraftArticleDraft> {
    assertCanAccessClientOrganization(actor, brief.clientOrganizationId);

    // Monotonic version per (tenant, brief): next = highest existing + 1.
    const existing = await this.drafts.listByArticleBrief(brief.id);
    const highest = existing.reduce((max, draft) => (draft.version > max ? draft.version : max), 0);
    const version = highest + 1;

    const compiledAt = this.infra.clock.now().toISOString();
    const draft = compileArticleDraft(brief, providerContents, {
      id: this.infra.ids.next(),
      version,
      compiledAt,
    });
    await this.drafts.add(draft);
    await emitAudit(
      this.infra,
      actor,
      draft,
      "article_draft.compiled",
      "ArticleDraft",
      draft.id,
      compiledAt,
    );
    return draft;
  }
}
