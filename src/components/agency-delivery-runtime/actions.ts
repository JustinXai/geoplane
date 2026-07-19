import type {AgencyWorkflowStage,AgencyWorkflowStatus} from "../../runtime/agency-delivery/contracts.js";
import {registerAgencyDelivery,moveAgencyWorkflow,type ApiClient,defaultApiClient} from "../../lib/api-client/index.js";

export interface AgencyDeliveryScope{readonly agencyOrganizationId:string;readonly clientOrganizationId:string;readonly projectId:string}
export function submitWorkflowTransition(scope:AgencyDeliveryScope,input:{stage:AgencyWorkflowStage;toStatus:AgencyWorkflowStatus;reason:string},client:ApiClient=defaultApiClient){return moveAgencyWorkflow({...scope,...input},client)}
export function submitDeliveryAction(scope:AgencyDeliveryScope,input:{action:"MARK_READY"|"REGISTER_DELIVERED";receiptReference?:string},client:ApiClient=defaultApiClient){return registerAgencyDelivery({...scope,...input},client)}
