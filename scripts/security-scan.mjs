#!/usr/bin/env node
/**
 * Recovery classification: RECONSTRUCTED_FROM_FROZEN_SPEC
 * Minimal, dependency-free re-implementation of the manual pre-git-add
 * scan used to build the baseline (see docs/rebuild/SECURITY_IMPORT_REPORT.md).
 * Scans tracked, non-ignored files for obvious secret patterns before a
 * checkpoint is committed. Not a replacement for human review.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

const PLACEHOLDER_VALUES = new Set(["change_me", "changeme", "test", "example", "placeholder", "xxx"]);

// [pattern, label, credentialGroupIndex?] - if credentialGroupIndex is set,
// a match is only a real hit when that capture group is NOT a known
// placeholder value (e.g. CHANGE_ME quoted in reviewed documentation).
const SECRET_PATTERNS = [
  [/OPENAI_API_KEY\s*=\s*(\S+)/i, "OPENAI_API_KEY", 1],
  [/DEEPSEEK_API_KEY\s*=\s*(\S+)/i, "DEEPSEEK_API_KEY", 1],
  [/DATABASE_URL\s*=\s*['"]?[a-z]+:\/\/[^'"\s:]+:([^'"\s@]+)@/i, "DATABASE_URL with embedded credential", 1],
  [/POSTGRES_PASSWORD\s*=\s*(\S+)/i, "POSTGRES_PASSWORD", 1],
  [/JWT_SECRET\s*=\s*(\S+)/i, "JWT_SECRET", 1],
  [/SESSION_SECRET\s*=\s*(\S+)/i, "SESSION_SECRET", 1],
  [/Authorization:\s*Bearer\s+(\S+)/i, "Authorization Bearer header", 1],
  [/(sk-[A-Za-z0-9]{10,})/, "sk- style API key", 1],
  [/([A-Za-z0-9._%+-]+@(?:gmail|qq|163|126|outlook|hotmail|yahoo)\.[a-z.]+)/i, "real-looking personal email", null],
  [/(\b1[3-9]\d{9}\b)/, "CN phone number pattern", null],
];

function isPlaceholder(raw) {
  if (!raw) return false;
  return PLACEHOLDER_VALUES.has(raw.replace(/[`'".,]/g, "").toLowerCase());
}

const files = execFileSync("git", ["ls-files"], { encoding: "utf8" })
  .split("\n")
  .filter(Boolean);

let hits = 0;
for (const file of files) {
  let stat;
  try {
    stat = statSync(file);
  } catch {
    continue;
  }
  if (!stat.isFile() || stat.size > 2_000_000) continue;
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue; // binary or unreadable, skip
  }
  for (const [pattern, label, credentialGroup] of SECRET_PATTERNS) {
    const match = pattern.exec(text);
    if (!match) continue;
    if (credentialGroup && isPlaceholder(match[credentialGroup])) continue;
    console.error(`SENSITIVE: ${file} (${label})`);
    hits++;
  }
}

if (hits > 0) {
  console.error(`security-scan: ${hits} suspected sensitive match(es).`);
  process.exit(1);
}
console.log("security-scan: clean.");
