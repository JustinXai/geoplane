/**
 * One-command, read-only backup of exact loopback geoplane_local_runtime.
 * No URL/password is accepted on argv or printed. Evidence is always outside the repository.
 */
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  parseArgs,
  resolveConnection,
  runProcess,
  sha256File,
} from "../backup/pg-lib.mjs";
import {
  assertExactDatabase,
  assertLocalOnlyMode,
  assertLoopback,
  defaultLocalEvidenceDir,
  evidenceLine,
  LOCAL_RUNTIME_DB,
  outsideRepoDirectory,
  providerCredentialFreeEnv,
  readBusinessSummary,
  repoRoot,
  summariesEqual,
} from "./local-lib.mjs";

const genericBackup = join(repoRoot, "scripts", "backup", "backup.mjs");

export async function runLocalRuntimeBackup(argv = process.argv.slice(2)) {
  assertLocalOnlyMode();
  const flags = parseArgs(argv);
  if (flags.url || flags.db || flags.test || flags.force) {
    throw new Error("--url/--db/--test/--force are forbidden; this command only backs up exact local runtime");
  }
  const source = resolveConnection({});
  if (!source) throw new Error("GEO_DATABASE_URL is required");
  assertLoopback(source);
  assertExactDatabase(source, LOCAL_RUNTIME_DB, "back up");

  const outDir = outsideRepoDirectory(
    typeof flags.out === "string"
      ? flags.out
      : process.env.LOCAL_BACKUP_DIR?.trim() || defaultLocalEvidenceDir(tmpdir()),
  );
  const before = await readBusinessSummary(source);
  const backup = await runProcess(process.execPath, [genericBackup, "--out", outDir], {
    env: providerCredentialFreeEnv(),
  });
  const artifact = evidenceLine(backup.stdout, "ARTIFACT ");
  const printedChecksum = evidenceLine(backup.stdout, "CHECKSUM sha256 ");
  if (!existsSync(artifact)) throw new Error("backup artifact reported by backup CLI does not exist");
  const checksum = await sha256File(artifact);
  if (checksum.toLowerCase() !== printedChecksum.toLowerCase()) {
    throw new Error("backup checksum evidence does not match artifact bytes");
  }
  const after = await readBusinessSummary(source);
  if (!summariesEqual(before, after)) {
    throw new Error("local runtime changed during backup; discard this artifact and retry while quiesced");
  }

  const checksumFile = `${artifact}.sha256`;
  const manifestFile = `${artifact}.manifest.json`;
  writeFileSync(checksumFile, `${checksum}  ${basename(artifact)}\n`, { encoding: "utf8", flag: "wx" });
  writeFileSync(
    manifestFile,
    `${JSON.stringify(
      {
        version: "LOCAL_RUNTIME_BACKUP_V1",
        sourceDatabase: LOCAL_RUNTIME_DB,
        artifact,
        checksumSha256: checksum,
        businessSummary: before,
      },
      null,
      2,
    )}\n`,
    { encoding: "utf8", flag: "wx" },
  );

  console.log(`ARTIFACT ${artifact}`);
  console.log(`CHECKSUM_FILE ${checksumFile}`);
  console.log(`MANIFEST ${manifestFile}`);
  console.log(`CHECKSUM_VERIFIED sha256 ${checksum}`);
  console.log("LOCAL_RUNTIME_BACKUP_V1 PASS REAL_PROVIDER_CALLS=0 REMOTE_WRITE_ATTEMPTS=0");
  return { artifact, checksumFile, manifestFile, checksum, businessSummary: before };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runLocalRuntimeBackup().catch((error) => {
    console.error(`local-backup: FAILED — ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
