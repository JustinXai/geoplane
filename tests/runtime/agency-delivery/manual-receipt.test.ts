import { describe, expect, it } from "vitest";
import { AgencyDeliveryControlService } from "../../../src/runtime/agency-delivery/delivery-control.js";
import type { AgencyDeliveryWritePort } from "../../../src/runtime/agency-delivery/ports.js";

describe("manual agency delivery receipt", () => {
  it("persists the normalized receipt reference in the append-only delivery record", async () => {
    const records: any[] = [];
    const writes: AgencyDeliveryWritePort = {
      async latestWorkflowStatus(){ return "COMPLETED"; }, async appendWorkflowEvent(){},
      async latestDeliveryStatus(){ return "READY"; }, async appendDeliveryRecord(value){ records.push(value); },
    };
    const service = new AgencyDeliveryControlService(writes,{async isAuthorized(){return true;}},{async findClientOrganizationId(){return "client";}},{next:()=>"delivery-id"},()=>"2026-07-19T00:00:00.000Z");
    await service.registerDelivered({agencyOrganizationId:"agency",clientOrganizationId:"client",projectId:"project",actorUserId:"operator",receiptReference:"  receipt-001  "});
    expect(records[0]).toMatchObject({status:"DELIVERED",receiptReference:"receipt-001"});
  });
});
