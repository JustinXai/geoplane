import {createHash} from "node:crypto";
import {detectKeywordImportFormat,parseCsvRecords,parseXlsxRecords} from "../keywords/importer.js";
import type {GenericKeywordImportRow,GenericKeywordParsedFile} from "./contracts.js";

const optional=["category","note","region","period_start","period_end","metric_kind","metric_value","metric_unit","observed_at","source_reference"] as const;
export function parseGenericKeywordImport(fileName:string,bytes:Uint8Array):GenericKeywordParsedFile{
  const format=detectKeywordImportFormat(fileName);
  const records=format==="CSV"?parseCsvRecords(new TextDecoder("utf-8",{fatal:true}).decode(bytes).replace(/^\uFEFF/,"")):parseXlsxRecords(bytes);
  const header=records[0]?.map(v=>v.trim().toLowerCase())??[];const keywordIndex=header.indexOf("keyword");if(keywordIndex<0)throw new Error("MISSING_REQUIRED_HEADER:keyword");
  const rows:GenericKeywordImportRow[]=[];const rejected:{sourceRow:number;code:string}[]=[];
  const at=(row:readonly string[],name:string)=>{const i=header.indexOf(name);return i<0?"":row[i]?.trim()??"";};
  for(let i=1;i<records.length;i++){const row=records[i]!;if(row.every(v=>!v?.trim()))continue;const sourceRow=i+1,keyword=at(row,"keyword");if(!keyword){rejected.push({sourceRow,code:"MISSING_KEYWORD"});continue;}const metricText=at(row,"metric_value"),metricValue=metricText?Number(metricText):undefined;if(metricText&&(!Number.isFinite(metricValue)||metricValue!<0)){rejected.push({sourceRow,code:"INVALID_METRIC"});continue;}if(["period_start","period_end","observed_at"].some(key=>at(row,key)&&Number.isNaN(Date.parse(at(row,key))))){rejected.push({sourceRow,code:"INVALID_DATE"});continue;}const parsed:any={sourceRow,keyword};for(const key of optional){if(key==="metric_value")continue;const value=at(row,key);if(value)parsed[camel(key)]=value;}if(metricValue!==undefined)parsed.metricValue=metricValue;rows.push(parsed);}
  return{format,sourceHash:createHash("sha256").update(bytes).digest("hex"),rows,rejected};
}
function camel(v:string){return v.replace(/_([a-z])/g,(_,x:string)=>x.toUpperCase());}
