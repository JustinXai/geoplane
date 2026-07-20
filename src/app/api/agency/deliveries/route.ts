/**
 * GET /api/agency/deliveries — agency delivery receipts across all authorized clients.
 *
 * Returns a list of agency delivery records (mark-ready + delivered) for all clients
 * the agency is ACTIVE-assigned to. Requires AGENCY_OWNER or AGENCY_OPERATOR role.
 *
 * Query parameters:
 *   - ?clientOrganizationId=xxx: Filter by specific client
 *   - ?projectId=xxx: Filter by specific project
 *   - ?status=READY|DELIVERED: Filter by delivery status
 *
 * Unauthenticated -> 401; not an agency role -> 403.
 * Checkpoint Manual Delivery (Agent D).
 */
import { apiOk } from "../../../../runtime/api-contracts/index.js";
import { toHttpResponse } from "../../../../runtime/auth/http.js";
import { getAuthRuntime } from "../../../../runtime/auth/runtime-context.js";
import { createAgencyDeliveryRuntime } from "../../../../runtime/agency-delivery/runtime-context.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Agency-facing view of a delivery record. */
export interface AgencyDeliveryRecordViewV1 {
  readonly id: string;
  readonly agencyOrganizationId: string;
  readonly clientOrganizationId: string;
  readonly projectId: string;
  readonly status: "READY" | "DELIVERED";
  readonly actorUserId: string;
  readonly occurredAt: string;
  readonly receiptReference: string | null;
}

export async function GET(request: Request): Promise<Response> {
  const rt = getAuthRuntime();
  const session = await rt.resolveSession(request.headers.get("cookie"));

  if (!session) {
    return toHttpResponse(apiOk({ error: "UNAUTHENTICATED" }));
  }

  // Only agency roles can access
  if (session.role !== "AGENCY_OWNER" && session.role !== "AGENCY_OPERATOR" && session.role !== "PLATFORM_SUPER_ADMIN") {
    return toHttpResponse(apiOk({ error: "FORBIDDEN" }));
  }

  const url = new URL(request.url);
  const clientOrganizationId = url.searchParams.get("clientOrganizationId");
  const projectId = url.searchParams.get("projectId");
  const statusFilter = url.searchParams.get("status");

  try {
    const agencyRt = createAgencyDeliveryRuntime(rt.db);

    // Build the query based on filters
    let query = `
      SELECT id, agency_organization_id, client_organization_id, project_id,
             status, actor_user_id, occurred_at, receipt_reference
        FROM agency_delivery_record
       WHERE agency_organization_id = $1
    `;
    const params: (string | null)[] = [session.organizationId];
    let paramIndex = 2;

    if (clientOrganizationId) {
      query += ` AND client_organization_id = $${paramIndex}`;
      params.push(clientOrganizationId);
      paramIndex++;
    }

    if (projectId) {
      query += ` AND project_id = $${paramIndex}`;
      params.push(projectId);
      paramIndex++;
    }

    if (statusFilter && ["READY", "DELIVERED"].includes(statusFilter)) {
      query += ` AND status = $${paramIndex}`;
      params.push(statusFilter);
      paramIndex++;
    }

    query += ` ORDER BY occurred_at DESC, id DESC`;

    const result = await agencyRt.reads.listAuthorizedClients(session.organizationId);

    // Get all delivery records for authorized clients
    const deliveryQuery = `
      SELECT adr.id, adr.agency_organization_id, adr.client_organization_id,
             adr.project_id, adr.status, adr.actor_user_id, adr.occurred_at, adr.receipt_reference
        FROM agency_delivery_record adr
        JOIN agency_client_assignment aca
          ON aca.client_organization_id = adr.client_organization_id
          AND aca.agency_organization_id = adr.agency_organization_id
       WHERE adr.agency_organization_id = $1
         AND aca.status = 'ACTIVE'
    `;
    const deliveryParams: (string | null)[] = [session.organizationId];
    let deliveryParamIndex = 2;

    let finalQuery = deliveryQuery;
    if (clientOrganizationId) {
      finalQuery += ` AND adr.client_organization_id = $${deliveryParamIndex}`;
      deliveryParams.push(clientOrganizationId);
      deliveryParamIndex++;
    }

    if (projectId) {
      finalQuery += ` AND adr.project_id = $${deliveryParamIndex}`;
      deliveryParams.push(projectId);
      deliveryParamIndex++;
    }

    if (statusFilter && ["READY", "DELIVERED"].includes(statusFilter)) {
      finalQuery += ` AND adr.status = $${deliveryParamIndex}`;
      deliveryParams.push(statusFilter);
      deliveryParamIndex++;
    }

    finalQuery += ` ORDER BY adr.occurred_at DESC, adr.id DESC`;

    const records = await rt.db.query<{
      id: string;
      agency_organization_id: string;
      client_organization_id: string;
      project_id: string;
      status: "READY" | "DELIVERED";
      actor_user_id: string;
      occurred_at: Date;
      receipt_reference: string | null;
    }>(finalQuery, deliveryParams);

    const views: AgencyDeliveryRecordViewV1[] = records.rows.map((row) => ({
      id: row.id,
      agencyOrganizationId: row.agency_organization_id,
      clientOrganizationId: row.client_organization_id,
      projectId: row.project_id,
      status: row.status,
      actorUserId: row.actor_user_id,
      occurredAt: row.occurred_at.toISOString(),
      receiptReference: row.receipt_reference,
    }));

    return toHttpResponse(apiOk(views));
  } catch (error) {
    return toHttpResponse(apiOk({ error: "INTERNAL_ERROR", message: String(error) }));
  }
}
