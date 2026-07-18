/**
 * KeywordQuestionService — the entry point of the GEO business chain
 * (KnowledgePackage -> IndustryProfile -> KeywordQuestionMap, chain items
 * 1-3). Every mutation is tenant-isolated via the frozen
 * `assertCanAccessClientOrganization` and audited.
 *
 * KnowledgePackages are created in `DRAFT` status only; sealing is a separate,
 * not-modeled-here transition — and because the repository ports are
 * append-only (no `update`), there is no way for this service to mutate an
 * already-recorded package in place.
 */
import { assertCanAccessClientOrganization } from "../../../contracts/tenancy/authorization.js";
import type { AuthorizationContext } from "../../../contracts/tenancy/entities.js";
import type {
  GeoValidationGateLevel,
  IndustryProfile,
  KeywordQuestionEntry,
  KeywordQuestionMap,
  KnowledgePackage,
} from "../../../contracts/geo-business/entities.js";
import type {
  IndustryProfileRepository,
  KeywordQuestionMapRepository,
  KnowledgePackageRepository,
} from "../ports.js";
import { emitAudit, type GeoRuntimeInfra } from "./support.js";

export interface CreateKnowledgePackageInput {
  readonly clientOrganizationId: string;
  readonly projectId: string;
  readonly version: number;
  readonly title: string;
  readonly sourceDescription: string;
}

export interface CreateIndustryProfileInput {
  readonly clientOrganizationId: string;
  readonly projectId: string;
  readonly verticalSlug: string;
  readonly verticalLabel: string;
  readonly validationGateLevel: GeoValidationGateLevel;
  readonly ruleSetVersion: number;
}

export interface CreateKeywordQuestionMapInput {
  readonly knowledgePackage: KnowledgePackage;
  readonly industryProfileId: string;
  readonly entries: KeywordQuestionEntry[];
}

export class KeywordQuestionService {
  constructor(
    private readonly knowledgePackages: KnowledgePackageRepository,
    private readonly industryProfiles: IndustryProfileRepository,
    private readonly keywordQuestionMaps: KeywordQuestionMapRepository,
    private readonly infra: GeoRuntimeInfra,
  ) {}

  async createKnowledgePackage(
    actor: AuthorizationContext,
    input: CreateKnowledgePackageInput,
  ): Promise<KnowledgePackage> {
    assertCanAccessClientOrganization(actor, input.clientOrganizationId);
    const createdAt = this.infra.clock.now().toISOString();
    const kp: KnowledgePackage = {
      id: this.infra.ids.next(),
      clientOrganizationId: input.clientOrganizationId,
      projectId: input.projectId,
      version: input.version,
      title: input.title,
      sourceDescription: input.sourceDescription,
      status: "DRAFT",
      createdAt,
    };
    await this.knowledgePackages.add(kp);
    await emitAudit(
      this.infra,
      actor,
      kp,
      "knowledge_package.created",
      "KnowledgePackage",
      kp.id,
      createdAt,
    );
    return kp;
  }

  async createIndustryProfile(
    actor: AuthorizationContext,
    input: CreateIndustryProfileInput,
  ): Promise<IndustryProfile> {
    assertCanAccessClientOrganization(actor, input.clientOrganizationId);
    const timestamp = this.infra.clock.now().toISOString();
    const profile: IndustryProfile = {
      id: this.infra.ids.next(),
      clientOrganizationId: input.clientOrganizationId,
      projectId: input.projectId,
      verticalSlug: input.verticalSlug,
      verticalLabel: input.verticalLabel,
      validationGateLevel: input.validationGateLevel,
      ruleSetVersion: input.ruleSetVersion,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.industryProfiles.add(profile);
    await emitAudit(
      this.infra,
      actor,
      profile,
      "industry_profile.created",
      "IndustryProfile",
      profile.id,
      timestamp,
    );
    return profile;
  }

  async createKeywordQuestionMap(
    actor: AuthorizationContext,
    input: CreateKeywordQuestionMapInput,
  ): Promise<KeywordQuestionMap> {
    assertCanAccessClientOrganization(actor, input.knowledgePackage.clientOrganizationId);
    const createdAt = this.infra.clock.now().toISOString();
    const map: KeywordQuestionMap = {
      id: this.infra.ids.next(),
      clientOrganizationId: input.knowledgePackage.clientOrganizationId,
      projectId: input.knowledgePackage.projectId,
      knowledgePackageId: input.knowledgePackage.id,
      // Pin provenance to the exact package version used at derivation time.
      knowledgePackageVersion: input.knowledgePackage.version,
      industryProfileId: input.industryProfileId,
      entries: input.entries,
      createdAt,
    };
    await this.keywordQuestionMaps.add(map);
    await emitAudit(
      this.infra,
      actor,
      map,
      "keyword_question_map.created",
      "KeywordQuestionMap",
      map.id,
      createdAt,
    );
    return map;
  }
}
