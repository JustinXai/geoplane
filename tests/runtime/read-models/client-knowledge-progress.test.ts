import { describe,expect,it,vi } from "vitest";
import { readClientKnowledgeProgress } from "../../../src/runtime/read-models/domestic-workspaces.js";

describe("客户企业资料进度读取模型",()=>{
  it("始终使用客户与项目双重范围并返回可解释状态",async()=>{
    const query=vi.fn().mockResolvedValue({rows:[{package_count:2,confirmed_package_count:1,document_count:5,open_issue_count:3,missing_information_count:2,updated_at:"2026-07-19T00:00:00.000Z"}],rowCount:1});
    const result=await readClientKnowledgeProgress({query} as never,"client-a","project-a");
    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0]?.[1]).toEqual(["client-a","project-a"]);
    expect(result).toEqual(expect.objectContaining({status:"NEEDS_INFORMATION",packageCount:2,documentCount:5,missingInformationCount:2}));
  });

  it("没有知识包时不会计算虚假的完成百分比",async()=>{
    const query=vi.fn().mockResolvedValue({rows:[{package_count:0,confirmed_package_count:0,document_count:0,open_issue_count:0,missing_information_count:0,updated_at:null}],rowCount:1});
    const result=await readClientKnowledgeProgress({query} as never,"client-a","project-a");
    expect(result.status).toBe("NOT_STARTED");
    expect(result.updatedAt).toBeNull();
    expect(result).not.toHaveProperty("completionPercentage");
  });
});
