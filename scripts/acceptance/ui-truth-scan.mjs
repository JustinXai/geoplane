import { resolve } from "node:path";
import { scanUiTruthEvidence } from "./ui-truth-scan-lib.mjs";

const directory = resolve(process.argv[2] ?? "outputs/p0-v2/final-acceptance");
const report = scanUiTruthEvidence(directory);
console.log(JSON.stringify({ evidenceDirectory: directory, ...report }, null, 2));
if (report.decision !== "PASS") process.exitCode = 1;
