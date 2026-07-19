import {readFileSync} from "node:fs";
import {describe,expect,it} from "vitest";
import {createApiClient,type FetchLike} from "../../../src/lib/api-client/http.js";
import {submitDeliveryAction,submitWorkflowTransition} from "../../../src/components/agency-delivery-runtime/actions.js";
import {apiOk} from "../../../src/runtime/api-contracts/index.js";

function recorder(){const calls:{url:string;method:string;body:unknown}[]=[];const fetch:FetchLike=async(url,init)=>{calls.push({url,method:String(init?.method??"GET"),body:init?.body?JSON.parse(String(init.body)):null});return{ok:true,status:200,text:async()=>JSON.stringify(apiOk({saved:true}))}};return{client:createApiClient({fetch}),calls}}

describe("real login and agency delivery UI wiring",()=>{
  it("login posts to the real route and has all role landings",()=>{const source=readFileSync(new URL("../../../src/app/login/page.tsx",import.meta.url),"utf8");expect(source).toContain('"/api/auth/login"');expect(source).toContain('ops:"/ops"');expect(source).toContain('agency:"/agency"');expect(source).toContain('client:"/app"');expect(source).not.toMatch(/tenancy-auth|rebuild\//i)});
  it("workflow and delivery actions submit the persisted P0 commands",async()=>{const {client,calls}=recorder();const scope={agencyOrganizationId:"agency",clientOrganizationId:"client",projectId:"project"};await submitWorkflowTransition(scope,{stage:"CONTENT_REVIEW",toStatus:"COMPLETED",reason:"人工审核完成"},client);await submitDeliveryAction(scope,{action:"REGISTER_DELIVERED",receiptReference:"receipt-1"},client);expect(calls).toEqual([{url:"/api/agency-delivery/workflow",method:"POST",body:{...scope,stage:"CONTENT_REVIEW",toStatus:"COMPLETED",reason:"人工审核完成"}},{url:"/api/agency-delivery/deliveries",method:"POST",body:{...scope,action:"REGISTER_DELIVERED",receiptReference:"receipt-1"}}])});
});
