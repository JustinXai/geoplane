import {describe,expect,it} from "vitest";
import {createApiClient,type FetchLike} from "../../../src/lib/api-client/http.js";
import {getAccountCenter,getManualProbeEntryOptions,getBaiduKeywordOverview} from "../../../src/lib/api-client/domestic.js";
import {apiOk} from "../../../src/runtime/api-contracts/index.js";
import {capability} from "../../../src/runtime/ui-adapters/capabilities.js";
import {chineseApiError} from "../../../src/runtime/ui-adapters/chinese-errors.js";

function client(){const calls:{url:string;method:string}[]=[];const fetch:FetchLike=async(url,init)=>({ok:true,status:200,text:async()=>JSON.stringify(apiOk({}))});const api=createApiClient({fetch:async(url,init)=>{calls.push({url,method:String(init?.method??"GET")});return fetch(url,init)}});return{api,calls}}

describe("domestic UI API wiring",()=>{
  it("uses only real read routes",async()=>{const {api,calls}=client();await getAccountCenter(api);await getBaiduKeywordOverview("project 1",api);await getManualProbeEntryOptions(api);expect(calls).toEqual([
    {url:"/api/accounts",method:"GET"},{url:"/api/keywords/projects/project%201/overview",method:"GET"},{url:"/api/probes/options",method:"GET"},
  ])});
  it("marks missing backend actions instead of enabling them",()=>{expect(capability("account.revoke").state).toBe("BACKEND_CAPABILITY_GAP");expect(capability("probe.record").state).toBe("AVAILABLE")});
  it("maps formal errors to understandable Chinese",()=>{expect(chineseApiError("FORBIDDEN")).toContain("没有权限");expect(chineseApiError("CONFLICT")).toContain("刷新")});
});
