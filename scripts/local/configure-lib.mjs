/** LOCAL_ENVIRONMENT_RUNTIME_V1 — pure validation and atomic .env.local writer. */
import { chmodSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  LOCAL_DATABASES,
  localKeyIsUsable,
  localPort,
  parseLocalDatabaseUrl,
  providerRuntimeIsExplicitlyOff,
} from "./runtime-lib.mjs";

const PLACEHOLDER = /(change[_-]?me|placeholder|example)/i;
const REQUIRED_KEYS = ["SESSION_SIGNING_KEY_CURRENT", "REVIEW_REFERENCE_KEY_CURRENT"];
const PILOT_PASSWORDS = [
  "LOCAL_PLATFORM_ADMIN_PASSWORD",
  "LOCAL_AGENCY_OWNER_PASSWORD",
  "LOCAL_CLIENT_OWNER_PASSWORD",
];

function requiredValue(environment, name) {
  const value = environment[name];
  if (typeof value !== "string" || value === "") throw new Error(`${name} is missing from the current process environment`);
  if (value !== value.trim() || /[\r\n\0]/.test(value)) throw new Error(`${name} contains unsupported whitespace or control characters`);
  return value;
}

export function validateLocalConfiguration(environment = process.env) {
  const values = {};
  for (const [role, definition] of Object.entries(LOCAL_DATABASES)) {
    const value = requiredValue(environment, definition.env);
    if (PLACEHOLDER.test(value)) throw new Error(`${definition.env} contains a forbidden placeholder`);
    parseLocalDatabaseUrl(value, role);
    if (new URL(value).password === "") throw new Error(`${definition.env} must contain a database credential`);
    values[definition.env] = value;
  }

  for (const name of REQUIRED_KEYS) {
    const value = requiredValue(environment, name);
    if (!localKeyIsUsable(value)) {
      throw new Error(`${name} must be a non-placeholder value of at least 32 characters`);
    }
    values[name] = value;
  }
  if (values.SESSION_SIGNING_KEY_CURRENT === values.REVIEW_REFERENCE_KEY_CURRENT) {
    throw new Error("SESSION_SIGNING_KEY_CURRENT and REVIEW_REFERENCE_KEY_CURRENT must be distinct");
  }

  for (const name of PILOT_PASSWORDS) {
    const value = requiredValue(environment, name);
    if (
      value.length < 12 ||
      Buffer.byteLength(value, "utf8") > 1024 ||
      !/[a-z]/.test(value) ||
      !/[A-Z]/.test(value) ||
      !/[0-9]/.test(value) ||
      /(password|change[_ -]?me|example|placeholder)/i.test(value)
    ) {
      throw new Error(`${name} does not meet the sanitized local account password policy`);
    }
    values[name] = value;
  }
  if (new Set(PILOT_PASSWORDS.map((name) => values[name])).size !== PILOT_PASSWORDS.length) {
    throw new Error("the three sanitized local account passwords must be distinct");
  }

  const provider = requiredValue(environment, "PROVIDER_RUNTIME_ENABLED");
  if (!providerRuntimeIsExplicitlyOff(provider)) {
    throw new Error("PROVIDER_RUNTIME_ENABLED must be explicitly false");
  }
  values.PROVIDER_RUNTIME_ENABLED = "false";

  const previous = environment.SESSION_SIGNING_KEY_PREVIOUS;
  if (previous !== undefined && previous !== "") {
    if (!localKeyIsUsable(previous)) {
      throw new Error("SESSION_SIGNING_KEY_PREVIOUS must be empty or a non-placeholder value of at least 32 characters");
    }
    values.SESSION_SIGNING_KEY_PREVIOUS = previous;
  } else {
    values.SESSION_SIGNING_KEY_PREVIOUS = "";
  }

  const port = localPort((name) => (name === "LOCAL_APP_PORT" ? environment.LOCAL_APP_PORT ?? null : null));
  values.LOCAL_APP_PORT = String(port);
  values.LOCAL_ONLY_MODE = "TRUE";
  values.REMOTE_WRITE = "FORBIDDEN";
  const backupDir = requiredValue(environment, "LOCAL_BACKUP_DIR");
  values.LOCAL_BACKUP_DIR = backupDir;
  return values;
}

export function serializeLocalConfiguration(values) {
  const order = [
    "LOCAL_ONLY_MODE",
    "REMOTE_WRITE",
    "GEO_DATABASE_URL",
    "GEO_TEST_DATABASE_URL",
    "GEO_CANARY_DATABASE_URL",
    "SESSION_SIGNING_KEY_CURRENT",
    "SESSION_SIGNING_KEY_PREVIOUS",
    "REVIEW_REFERENCE_KEY_CURRENT",
    "LOCAL_PLATFORM_ADMIN_PASSWORD",
    "LOCAL_AGENCY_OWNER_PASSWORD",
    "LOCAL_CLIENT_OWNER_PASSWORD",
    "PROVIDER_RUNTIME_ENABLED",
    "LOCAL_APP_PORT",
    "LOCAL_BACKUP_DIR",
  ];
  return `${order.map((name) => `${name}=${values[name] ?? ""}`).join("\n")}\n`;
}

export function writeLocalConfigurationAtomic(root, values) {
  const target = join(root, ".env.local");
  const temporary = join(root, `.env.local.${process.pid}.${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, serializeLocalConfiguration(values), { encoding: "utf8", mode: 0o600, flag: "wx" });
    try {
      chmodSync(temporary, 0o600);
    } catch {
      // Windows may not implement POSIX mode bits; the file remains local and gitignored.
    }
    renameSync(temporary, target);
    try {
      chmodSync(target, 0o600);
    } catch {
      // Best effort on Windows.
    }
    return target;
  } catch (error) {
    try {
      unlinkSync(temporary);
    } catch {
      // Nothing to clean up.
    }
    throw error;
  }
}
