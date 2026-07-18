/**
 * PublishPackageService — builds the publication-ready package and its
 * channel-neutral content (chain items 11-12).
 *
 * Platform-neutral by default (SYSTEM_INVARIANTS_V1.md "Publication"):
 *
 *  - `createChannelNeutralPackage` delegates to the frozen smart constructor,
 *    which ALWAYS initializes `targetChannelIds` to `[]` — there is no
 *    parameter anywhere that accepts a pre-seeded channel list. Default
 *    selected-channel count is 0.
 *  - `selectTargetChannel` is the only way to add a channel: one at a time,
 *    explicit, via the frozen pure `addTargetChannel`. It returns the grown
 *    package in memory and does NOT overwrite the stored base package — the
 *    authoritative, auditable record of "which channels a human chose" is the
 *    DistributionPlan (with its required selectedByActorId + selectedAt), not a
 *    mutation of this append-only artifact.
 *  - `createPublishPackage` requires a real ArticleApproval value (not just an
 *    id) — nothing is packaged for publication without an approval.
 */
import { assertCanAccessClientOrganization } from "../../../contracts/tenancy/authorization.js";
import type { AuthorizationContext } from "../../../contracts/tenancy/entities.js";
import {
  addTargetChannel,
  buildPublishPackage,
  createChannelNeutralContentPackage,
  type ArticleApproval,
  type ArticleDraft,
  type ChannelNeutralContentBlock,
  type ChannelNeutralContentPackage,
  type PublishPackage,
} from "../../../contracts/geo-business/entities.js";
import type {
  ChannelNeutralContentPackageRepository,
  PublishPackageRepository,
} from "../ports.js";
import { emitAudit, type GeoRuntimeInfra } from "./support.js";

export class PublishPackageService {
  constructor(
    private readonly publishPackages: PublishPackageRepository,
    private readonly channelNeutralPackages: ChannelNeutralContentPackageRepository,
    private readonly infra: GeoRuntimeInfra,
  ) {}

  async createPublishPackage(
    actor: AuthorizationContext,
    approval: ArticleApproval,
    draft: ArticleDraft,
  ): Promise<PublishPackage> {
    assertCanAccessClientOrganization(actor, approval.clientOrganizationId);
    const pkg = buildPublishPackage(approval, draft, {
      id: this.infra.ids.next(),
      builtAt: this.infra.clock.now().toISOString(),
    });
    await this.publishPackages.add(pkg);
    await emitAudit(
      this.infra,
      actor,
      pkg,
      "publish_package.created",
      "PublishPackage",
      pkg.id,
      pkg.builtAt,
    );
    return pkg;
  }

  /** Always yields a package with exactly 0 target channels (see frozen constructor). */
  async createChannelNeutralPackage(
    actor: AuthorizationContext,
    publishPackage: PublishPackage,
    blocks: ChannelNeutralContentBlock[],
  ): Promise<ChannelNeutralContentPackage> {
    assertCanAccessClientOrganization(actor, publishPackage.clientOrganizationId);
    const pkg = createChannelNeutralContentPackage(publishPackage, blocks, {
      id: this.infra.ids.next(),
      createdAt: this.infra.clock.now().toISOString(),
    });
    await this.channelNeutralPackages.add(pkg);
    await emitAudit(
      this.infra,
      actor,
      pkg,
      "channel_neutral_content_package.created",
      "ChannelNeutralContentPackage",
      pkg.id,
      pkg.createdAt,
    );
    return pkg;
  }

  /**
   * Explicit, one-channel-at-a-time selection. Pure: returns a new package
   * value (via the frozen `addTargetChannel`) and does not overwrite stored
   * state — see the class doc comment for why persistence of the chosen set is
   * the DistributionPlan's responsibility, not a mutation here.
   */
  selectTargetChannel(
    pkg: ChannelNeutralContentPackage,
    channelId: string,
  ): ChannelNeutralContentPackage {
    return addTargetChannel(pkg, channelId);
  }
}
