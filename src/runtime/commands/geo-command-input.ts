/**
 * Request-body parsing helpers for the GEO business-chain command routes (Agent C — batch 2).
 *
 * Narrow, defensive readers over the untyped JSON body: each returns the well-typed value or null
 * so a route can bail with a clean 422 VALIDATION_FAILED rather than throwing. None of these read
 * or trust an organization id — server-side tenant resolution stays the route's responsibility.
 */

/** A non-blank string, or null. */
export function readString(body: Record<string, unknown>, key: string): string | null {
  const value = body[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/** A finite integer, or null (accepts a numeric value only — never coerces a string). */
export function readInteger(body: Record<string, unknown>, key: string): number | null {
  const value = body[key];
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

/** An array of non-blank strings (each trimmed), or null if absent/not an array/has a bad element. */
export function readStringArray(body: Record<string, unknown>, key: string): string[] | null {
  const value = body[key];
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.trim() === "") return null;
    out.push(item.trim());
  }
  return out;
}

/** A string[] the caller may omit entirely (-> []), but if present every element must be non-blank. */
export function readOptionalStringArray(
  body: Record<string, unknown>,
  key: string,
): string[] | null {
  if (body[key] === undefined || body[key] === null) return [];
  return readStringArray(body, key);
}
