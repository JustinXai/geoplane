import type { IndustryProfilePackSelection, VerticalPolicyPackDefinition } from "./entities.js";

export interface VerticalPolicyPackPort {
  get(packId: string, version: number): VerticalPolicyPackDefinition | null;
}

export interface IndustryProfilePackSelectionPort {
  find(projectId: string, industryProfileId: string): Promise<IndustryProfilePackSelection | null>;
}
