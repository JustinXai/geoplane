/**
 * DeliveryService — records that a specific channel was actually published to,
 * and derives publication status from the real records (chain item 14).
 *
 * "No automatic publication under any circumstance" is enforced by the frozen
 * `createPublicationReceipt`, which throws if `publishedByActorId` is empty or
 * one of the automatic/system sentinels ("system"/"auto"/"automated"/
 * "automatic"). This service delegates to it and never reimplements or relaxes
 * that check. `PublicationReceipt` can therefore never be created by a
 * system/automatic actor.
 *
 * `publicationStatus` is DERIVED from the real DistributionPlan + receipts via
 * the frozen `derivePublicationStatus` — it is never stored as its own mutable
 * field, so it cannot drift from the underlying append-only records.
 */
import { assertCanAccessClientOrganization } from "../../../contracts/tenancy/authorization.js";
import type { AuthorizationContext } from "../../../contracts/tenancy/entities.js";
import {
  createPublicationReceipt,
  derivePublicationStatus,
  type DistributionPlan,
  type PublicationReceipt,
  type PublicationStatus,
} from "../../../contracts/geo-business/entities.js";
import type { DeliveryRepository } from "../ports.js";
import { emitAudit, type GeoRuntimeInfra } from "./support.js";

export class DeliveryService {
  constructor(
    private readonly deliveries: DeliveryRepository,
    private readonly infra: GeoRuntimeInfra,
  ) {}

  async recordPublicationReceipt(
    actor: AuthorizationContext,
    plan: DistributionPlan,
    channelId: string,
    publishedByActorId: string,
  ): Promise<PublicationReceipt> {
    assertCanAccessClientOrganization(actor, plan.clientOrganizationId);
    // Frozen constructor enforces "never automatic" + "channel must be in plan".
    const receipt = createPublicationReceipt(plan, channelId, publishedByActorId, {
      id: this.infra.ids.next(),
      publishedAt: this.infra.clock.now().toISOString(),
    });
    await this.deliveries.add(receipt);
    await emitAudit(
      this.infra,
      actor,
      receipt,
      "publication_receipt.recorded",
      "PublicationReceipt",
      receipt.id,
      receipt.publishedAt,
    );
    return receipt;
  }

  /**
   * Derived, read-only status for a DistributionPlan. Never trusts a stored
   * status field — computed from the real receipts every call.
   */
  async publicationStatus(
    actor: AuthorizationContext,
    plan: DistributionPlan,
  ): Promise<PublicationStatus> {
    assertCanAccessClientOrganization(actor, plan.clientOrganizationId);
    const receipts = await this.deliveries.listByPlan(plan.id);
    return derivePublicationStatus(plan, receipts);
  }
}
