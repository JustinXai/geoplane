import { CapabilityGap, OpsPageHeader } from "./OpsPage.js";
export function CapabilityGapScreen({title,description,detail}:{readonly title:string;readonly description:string;readonly detail?:string}){return <><OpsPageHeader title={title} description={description}/><CapabilityGap detail={detail}/></>;}
