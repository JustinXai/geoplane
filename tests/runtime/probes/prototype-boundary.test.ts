import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "../../../middleware.js";
import {
  isIndependentDetectionPrototypeEnabled,
  OBSERVATION_GAP_DISPOSITION,
  PROBE_RUNTIME_CLASSIFICATION,
} from "../../../src/runtime/probes/prototype-boundary.js";

const original = process.env.NEXT_PUBLIC_INDEPENDENT_DETECTION_PROTOTYPE_ENABLED;
afterEach(() => {
  if (original === undefined) delete process.env.NEXT_PUBLIC_INDEPENDENT_DETECTION_PROTOTYPE_ENABLED;
  else process.env.NEXT_PUBLIC_INDEPENDENT_DETECTION_PROTOTYPE_ENABLED = original;
});

describe("独立检测原型边界", () => {
  it("默认关闭并声明延期归属", () => {
    expect(isIndependentDetectionPrototypeEnabled({})).toBe(false);
    expect(PROBE_RUNTIME_CLASSIFICATION).toBe("INDEPENDENT_DETECTION_SYSTEM_PROTOTYPE");
    expect(OBSERVATION_GAP_DISPOSITION).toBe("DEFERRED_TO_INDEPENDENT_DETECTION_SYSTEM");
  });

  it("关闭时页面和 API 均不可达", () => {
    delete process.env.NEXT_PUBLIC_INDEPENDENT_DETECTION_PROTOTYPE_ENABLED;
    expect(middleware(new NextRequest("http://localhost:3000/app/ai-results")).status).toBe(404);
    expect(middleware(new NextRequest("http://localhost:3000/api/probes/options")).status).toBe(404);
  });

  it("开启后页面继续进入既有登录与角色权限检查", () => {
    process.env.NEXT_PUBLIC_INDEPENDENT_DETECTION_PROTOTYPE_ENABLED = "TRUE";
    const response = middleware(new NextRequest("http://localhost:3000/app/ai-results"));
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("/login");
  });
});
