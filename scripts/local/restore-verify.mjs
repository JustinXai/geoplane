/**
 * Restore a checksummed local-runtime backup only into fresh geoplane_local_restore_verify, then
 * compare hashed business readback with the backup manifest. No raw business rows are printed.
 */
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Pool } from "pg";
import {
  assertAllowedRestoreTarget,
  formatPgUrl,
  parseArgs,
  resolveConnection,
  runProcess,
  verifyFileSha256,
} from "../backup/pg-lib.mjs";
import {
  assertExactDatabase,
  assertLocalOnlyMode,
  assertLoopback,
  LOCAL_RESTORE_VERIFY_DB,
  LOCAL_RUNTIME_DB,
  providerCredentialFreeEnv,
  readBusinessSummary,
  repoRoot,
  summariesEqual,
  withDatabase,
} from "./local-lib.mjs";

const genericRestore = fileURLToPath(new URL("../backup/restore.mjs", import.meta.url));

function readManifest(path) {
  if (!existsSync(path)) throw new Error("--manifest file does not exist");
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error("backup manifest is not valid JSON");
  }
  if (
    manifest?.version !== "LOCAL_RUNTIME_BACKUP_V1" ||
    manifest.sourceDatabase !== LOCAL_RUNTIME_DB ||
    typeof manifest.artifact !== "string" ||
    typeof manifest.checksumSha256 !== "string" ||
    typeof manifest.businessSummary?.summarySha256 !== "string"
  ) {
    throw new Error("backup manifest does not satisfy LOCAL_RUNTIME_BACKUP_V1");
  }
  return manifest;
}

function assertArtifactOutsideRepo(path) {
  const artifact = realpathSync(path);
  const root = realpathSync(repoRoot);
  const fromRepo = relative(root, artifact);
  if (fromRepo === "" || (!fromRepo.startsWith("..") && !isAbsolute(fromRepo))) {
    throw new Error("backup artifact must be outside the repository");
  }
  return artifact;
}

export async function runLocalRestoreVerify(argv = process.argv.slice(2)) {
  assertLocalOnlyMode();
  const flags = parseArgs(argv);
  if (flags.url || flags.db || flags.test || flags.force || flags.checksum || flags.dump) {
    throw new Error("database/force/dump overrides are forbidden; supply only --manifest and optional --user");
  }
  if (typeof flags.manifest !== "string") throw new Error("--manifest <file> is required");
  const manifest = readManifest(flags.manifest);
  if (!existsSync(manifest.artifact)) throw new Error("backup artifact from manifest does not exist");
  const artifact = assertArtifactOutsideRepo(manifest.artifact);
  await verifyFileSha256(artifact, manifest.checksumSha256);

  const source = resolveConnection({});
  if (!source) throw new Error("GEO_DATABASE_URL is required");
  assertLoopback(source);
  assertExactDatabase(source, LOCAL_RUNTIME_DB, "use as restore-verification base");
  assertAllowedRestoreTarget(LOCAL_RESTORE_VERIFY_DB);
  const target = withDatabase(source, LOCAL_RESTORE_VERIFY_DB);
  const user =
    typeof flags.user === "string"
      ? flags.user
      : process.env.GEO_PG_SUPERUSER?.trim() || "postgres";
  source.user = user;
  target.user = user;

  const admin = new Pool({
    connectionString: formatPgUrl(withDatabase(source, "postgres")),
    max: 1,
  });
  try {
    const exists = await admin.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [
      LOCAL_RESTORE_VERIFY_DB,
    ]);
    if ((exists.rowCount ?? 0) > 0) {
      throw new Error(
        `${LOCAL_RESTORE_VERIFY_DB} already exists; refusing to clean, overwrite, or reuse it`,
      );
    }
  } finally {
    await admin.end();
  }

  const restore = await runProcess(
    process.execPath,
    [
      genericRestore,
      "--db",
      LOCAL_RESTORE_VERIFY_DB,
      "--user",
      user,
      "--dump",
      artifact,
      "--checksum",
      manifest.checksumSha256,
    ],
    { env: providerCredentialFreeEnv() },
  );
  if (!restore.stdout.includes(`CHECKSUM_VERIFIED sha256 ${manifest.checksumSha256}`)) {
    throw new Error("restore CLI did not confirm checksum verification");
  }

  const restored = await readBusinessSummary(target);
  if (!summariesEqual(manifest.businessSummary, restored)) {
    throw new Error("restored business readback differs from the checksummed backup manifest");
  }
  console.log(`RESTORE_VERIFIED ${LOCAL_RESTORE_VERIFY_DB}`);
  console.log(`BUSINESS_READBACK sha256 ${restored.summarySha256}`);
  console.log("LOCAL_RESTORE_VERIFY_V1 PASS REAL_PROVIDER_CALLS=0 REMOTE_WRITE_ATTEMPTS=0");
  return { targetDatabase: LOCAL_RESTORE_VERIFY_DB, businessSummary: restored };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runLocalRestoreVerify().catch((error) => {
    console.error(`local-restore-verify: FAILED — ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
