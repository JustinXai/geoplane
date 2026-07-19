import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

describe("SESSION_ACTOR_BINDING_V1 route boundary", () => {
  it("binds distribution-plan selectedByActorId to the verified session", () => {
    const route = source("../../src/app/api/distribution-plans/route.ts");
    expect(route).toContain("selectedByActorId: session.userId");
    expect(route).not.toMatch(/readString\(body,\s*["']selectedByActorId["']\)/);
  });

  it("binds publication-receipt publishedByActorId to the verified session", () => {
    const route = source("../../src/app/api/publication-receipts/route.ts");
    expect(route).toContain("session.userId");
    expect(route).not.toMatch(/readString\(body,\s*["']publishedByActorId["']\)/);
  });

  it("verifies a password and uses one generic authentication failure", () => {
    const route = source("../../src/app/api/auth/login/route.ts");
    expect(route).toContain("verifyPassword(");
    expect(route).toContain("Invalid email or password.");
    expect(route).not.toContain("No user exists for that email.");
  });
});
