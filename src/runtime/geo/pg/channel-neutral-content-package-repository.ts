/**
 * ARTICLE_GATE_DELIVERY_RUNTIME_V1 — Postgres adapter for the E1
 * ChannelNeutralContentPackageRepository port, backed by the
 * channel_neutral_content_package (+ channel_neutral_content_block child) tables
 * of 0004_geo_article_delivery.sql.
 *
 * APPEND-ONLY: `add`/`getById`/`getByPublishPackage` only; a duplicate id raises
 * 23505, translated to the same append-only rejection the fake produces. The
 * package row and its blocks are written inside ONE transaction so a half-
 * persisted package can never exist.
 *
 * 0 DEFAULT CHANNELS: target_channel_ids DEFAULTs to '{}' at the schema level;
 * the frozen smart constructor always yields a package with 0 target channels,
 * and this adapter persists exactly that list (never seeds a default). The
 * authoritative record of which channels a human chose is the DistributionPlan,
 * not this package.
 */
import type {
  ChannelNeutralContentBlock,
  ChannelNeutralContentPackage,
} from "../../../contracts/geo-business/entities.js";
import type { DatabasePort } from "../../../persistence/database-port.js";
import type { ChannelNeutralContentPackageRepository } from "../ports.js";
import { isUniqueViolation, ParamList } from "./pg-support.js";

interface PackageRow {
  id: string;
  client_organization_id: string;
  project_id: string;
  publish_package_id: string;
  target_channel_ids: string[];
  created_at: Date;
}

interface BlockRow {
  kind: ChannelNeutralContentBlock["kind"];
  text: string;
  position: number;
}

export class PgChannelNeutralContentPackageRepository
  implements ChannelNeutralContentPackageRepository
{
  constructor(private readonly db: DatabasePort) {}

  async add(pkg: ChannelNeutralContentPackage): Promise<ChannelNeutralContentPackage> {
    try {
      await this.db.transaction(async (tx) => {
        const p = new ParamList();
        await tx.query(
          `INSERT INTO channel_neutral_content_package
             (id, client_organization_id, project_id, publish_package_id, target_channel_ids, created_at)
           VALUES (${p.add(pkg.id)}, ${p.add(pkg.clientOrganizationId)}, ${p.add(pkg.projectId)},
                   ${p.add(pkg.publishPackageId)}, ${p.array(pkg.targetChannelIds, "text[]")},
                   ${p.add(pkg.createdAt)})`,
          p.values,
        );

        for (let i = 0; i < pkg.blocks.length; i += 1) {
          const block = pkg.blocks[i];
          if (!block) continue;
          await tx.query(
            `INSERT INTO channel_neutral_content_block
               (client_organization_id, project_id, channel_neutral_content_package_id, kind, text, position)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [pkg.clientOrganizationId, pkg.projectId, pkg.id, block.kind, block.text, i],
          );
        }
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new Error(
          `PgChannelNeutralContentPackageRepository: refusing to overwrite existing id "${pkg.id}" (append-only).`,
        );
      }
      throw err;
    }

    return pkg;
  }

  async getById(id: string): Promise<ChannelNeutralContentPackage | undefined> {
    const res = await this.db.query<PackageRow>(
      "SELECT * FROM channel_neutral_content_package WHERE id = $1",
      [id],
    );
    const row = res.rows[0];
    if (!row) return undefined;
    return this.hydrate(row);
  }

  async getByPublishPackage(
    publishPackageId: string,
  ): Promise<ChannelNeutralContentPackage | undefined> {
    const res = await this.db.query<PackageRow>(
      `SELECT * FROM channel_neutral_content_package
       WHERE publish_package_id = $1
       ORDER BY created_at, id
       LIMIT 1`,
      [publishPackageId],
    );
    const row = res.rows[0];
    if (!row) return undefined;
    return this.hydrate(row);
  }

  private async hydrate(row: PackageRow): Promise<ChannelNeutralContentPackage> {
    const blockRes = await this.db.query<BlockRow>(
      `SELECT kind, text, position FROM channel_neutral_content_block
       WHERE channel_neutral_content_package_id = $1
       ORDER BY position`,
      [row.id],
    );

    const blocks: ChannelNeutralContentBlock[] = blockRes.rows.map((b) => ({
      kind: b.kind,
      text: b.text,
      order: b.position,
    }));

    return {
      id: row.id,
      clientOrganizationId: row.client_organization_id,
      projectId: row.project_id,
      publishPackageId: row.publish_package_id,
      blocks,
      targetChannelIds: row.target_channel_ids,
      createdAt: row.created_at.toISOString(),
    };
  }
}
