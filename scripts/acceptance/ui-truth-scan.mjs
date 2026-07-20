import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { collectRuntimeUiTruth, evaluateRuntimeUiTruth, scanUiTruthEvidence } from "./ui-truth-scan-lib.mjs";

const directory = resolve(process.argv[2] ?? "outputs/p0-v2/final-acceptance");
const baseUrl = process.env.UI_TRUTH_BASE_URL ?? process.env.SMOKE_TEST_BASE_URL ?? "http://127.0.0.1:3000";
const expectedGitSha =
  process.env.UI_TRUTH_EXPECTED_SHA ??
  execFileSync("git", ["rev-parse", "HEAD"], { cwd: resolve("."), encoding: "utf8" }).trim();
const staticReport = scanUiTruthEvidence(directory);
const runtime = await collectRuntimeUiTruth({ baseUrl });
const report = evaluateRuntimeUiTruth({ ...runtime, expectedGitSha, staticReport });
console.log(JSON.stringify({ evidenceDirectory: directory, baseUrl, ...report }, null, 2));
if (report.decision !== "PASS") process.exitCode = 1;
