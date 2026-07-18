/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * reconstruction_source: src/contracts/geo-business/entities.ts (checkpoint D6)
 * reconstruction_reason: acceptance-phase canonical contract unification -
 *   this file did not exist during the overnight rebuild; it is a curated
 *   re-export introduced during REBUILD_INTEGRATION_ACCEPTANCE_V1 so
 *   `src/contracts/index.ts` can expose a focused `publication` namespace
 *   without physically splitting entities.ts.
 * original_file_unavailable: n/a (net-new acceptance-phase file)
 *
 * Canonical distribution/publication-layer surface (chain items 9-12 -
 * PublishPackage through PublicationReceipt). Every lane/service that only
 * needs the publication layer should import from here rather than from
 * the full geo-business entities module, and must never redeclare an
 * equivalent status/channel shape locally.
 */
export type {
  PublishPackage,
  PublishPackageIdentity,
  ChannelNeutralContentBlock,
  ChannelNeutralContentPackage,
  ChannelNeutralContentPackageIdentity,
  DistributionPlan,
  PublicationReceipt,
  PublicationReceiptIdentity,
  PublicationStatus,
} from "./entities.js";
export {
  buildPublishPackage,
  createChannelNeutralContentPackage,
  addTargetChannel,
  createPublicationReceipt,
  derivePublicationStatus,
} from "./entities.js";
