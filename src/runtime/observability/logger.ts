/**
 * STAGING_OPERATIONS_V1 batch 1 (Agent E1) — safe structured logger.
 *
 * Emits ONE structured record per request/event with a fixed, allowlisted field set:
 *   { requestId, actorUserId, actorOrganizationId, clientOrganizationId, projectId,
 *     route, status, latencyMs, errorCode }
 *
 * Safety guarantee (two independent layers):
 *   1. ALLOWLIST — the emitted record is projected from a fixed field set. Any extra top-level
 *      field a caller passes (cookie, token, apiKey, ...) is simply never copied out, so it can
 *      never appear in a log line — even if the caller explicitly asks to log it.
 *   2. REDACTION GUARD — the optional free-form `context` bag is deep-walked and any key whose
 *      name matches a forbidden pattern (cookie / token / api key / authorization / secret /
 *      password / signing key / prompt / completion / provider response / knowledge|raw|content
 *      text / bearer / credential) has its value replaced with "[REDACTED]".
 *
 * Forbidden material this logger must NEVER emit: cookies, tokens, api keys, raw knowledge text,
 * provider prompts, and provider responses.
 */

// ---------------------------------------------------------------------------
// Public field model
// ---------------------------------------------------------------------------

export type LogLevel = "info" | "warn" | "error";

/** The fixed, safe field set. All optional; only present fields are emitted. */
export interface LogFields {
  readonly requestId?: string;
  readonly actorUserId?: string | null;
  readonly actorOrganizationId?: string | null;
  readonly clientOrganizationId?: string | null;
  readonly projectId?: string | null;
  readonly route?: string;
  readonly status?: number;
  readonly latencyMs?: number;
  readonly errorCode?: string | null;
  /** Optional free-form context — deep-redacted before emit. */
  readonly context?: Record<string, unknown>;
}

export interface StructuredLogRecord {
  readonly level: LogLevel;
  readonly timestamp: string;
  readonly requestId?: string;
  readonly actorUserId?: string | null;
  readonly actorOrganizationId?: string | null;
  readonly clientOrganizationId?: string | null;
  readonly projectId?: string | null;
  readonly route?: string;
  readonly status?: number;
  readonly latencyMs?: number;
  readonly errorCode?: string | null;
  readonly context?: Record<string, unknown>;
}

/** Where a record goes. Default writes one JSON line to stdout. */
export type LogSink = (record: StructuredLogRecord) => void;

export interface Logger {
  info(fields: LogFields): StructuredLogRecord;
  warn(fields: LogFields): StructuredLogRecord;
  error(fields: LogFields): StructuredLogRecord;
  log(level: LogLevel, fields: LogFields): StructuredLogRecord;
}

// ---------------------------------------------------------------------------
// Redaction guard
// ---------------------------------------------------------------------------

export const REDACTED = "[REDACTED]";

/**
 * Key-name patterns that must never have their value logged. Matched case-insensitively against
 * each object key. Deliberately broad: it is always safe to over-redact a log line.
 */
const FORBIDDEN_KEY_PATTERNS: readonly RegExp[] = [
  /cookie/i,
  /token/i,
  /api[-_ ]?key/i,
  /access[-_ ]?key/i,
  /secret/i,
  /password/i,
  /passwd/i,
  /authorization/i,
  /\bauth\b/i,
  /bearer/i,
  /credential/i,
  /signing[-_ ]?key/i,
  /session[-_ ]?key/i,
  /\bprompt\b/i,
  /provider[-_ ]?prompt/i,
  /provider[-_ ]?response/i,
  /completion/i,
  /knowledge[-_ ]?text/i,
  /raw[-_ ]?text/i,
  /content[-_ ]?text/i,
  /extracted[-_ ]?text/i,
];

/** True when a key name matches any forbidden pattern. */
export function isForbiddenKey(key: string): boolean {
  return FORBIDDEN_KEY_PATTERNS.some((re) => re.test(key));
}

/**
 * Deep-redacts an arbitrary value: any object key matching a forbidden pattern gets "[REDACTED]";
 * everything else is walked recursively. Cycles are broken. Never throws.
 */
export function redactForbidden<T>(value: T): T {
  return redactInner(value, new WeakSet<object>()) as T;
}

function redactInner(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactInner(item, seen));
  }

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isForbiddenKey(key) ? REDACTED : redactInner(val, seen);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Logger factory
// ---------------------------------------------------------------------------

const defaultSink: LogSink = (record) => {
  // One structured JSON line per record.
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(record));
};

export interface LoggerOptions {
  readonly sink?: LogSink;
  /** Injectable clock for deterministic tests. */
  readonly now?: () => Date;
}

/**
 * Builds a logger. The emitted record contains ONLY the allowlisted safe fields (plus a
 * deep-redacted `context`), so forbidden material cannot leak even if a caller passes it in.
 */
export function createLogger(options: LoggerOptions = {}): Logger {
  const sink = options.sink ?? defaultSink;
  const now = options.now ?? (() => new Date());

  function build(level: LogLevel, fields: LogFields): StructuredLogRecord {
    const record: {
      level: LogLevel;
      timestamp: string;
      requestId?: string;
      actorUserId?: string | null;
      actorOrganizationId?: string | null;
      clientOrganizationId?: string | null;
      projectId?: string | null;
      route?: string;
      status?: number;
      latencyMs?: number;
      errorCode?: string | null;
      context?: Record<string, unknown>;
    } = {
      level,
      timestamp: now().toISOString(),
    };

    // Allowlist projection: only these named fields are ever copied out.
    if (fields.requestId !== undefined) record.requestId = fields.requestId;
    if (fields.actorUserId !== undefined) record.actorUserId = fields.actorUserId;
    if (fields.actorOrganizationId !== undefined)
      record.actorOrganizationId = fields.actorOrganizationId;
    if (fields.clientOrganizationId !== undefined)
      record.clientOrganizationId = fields.clientOrganizationId;
    if (fields.projectId !== undefined) record.projectId = fields.projectId;
    if (fields.route !== undefined) record.route = fields.route;
    if (fields.status !== undefined) record.status = fields.status;
    if (fields.latencyMs !== undefined) record.latencyMs = fields.latencyMs;
    if (fields.errorCode !== undefined) record.errorCode = fields.errorCode;

    // Free-form context is deep-redacted before it is allowed anywhere near a log line.
    if (fields.context !== undefined) {
      record.context = redactForbidden(fields.context);
    }

    return record;
  }

  function emit(level: LogLevel, fields: LogFields): StructuredLogRecord {
    const record = build(level, fields);
    sink(record);
    return record;
  }

  return {
    log: emit,
    info: (fields) => emit("info", fields),
    warn: (fields) => emit("warn", fields),
    error: (fields) => emit("error", fields),
  };
}
