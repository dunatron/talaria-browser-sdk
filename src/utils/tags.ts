/**
 * Tag normalization and high-cardinality heuristics for the browser SDK.
 *
 * Precedence when merging (later wins): auto → init → scope/withTags → per-call.
 */

export const MAX_TAGS_PER_EVENT = 20;
export const MAX_TAG_KEY_LENGTH = 64;
export const MAX_TAG_VALUE_LENGTH = 128;
export const MAX_TAG_TOTAL_UTF8_BYTES = 2048;

const KEY_PATTERN = /^[a-z0-9_.-]+$/;

/** Keys that usually belong in extra / top-level context, not tags. */
export const HIGH_CARDINALITY_TAG_KEYS = new Set([
  'user_id',
  'userid',
  'request_id',
  'requestid',
  'business_id',
  'order_id',
  'email',
  'url',
  'uuid',
  'session_id',
  'trace_id',
  'span_id',
]);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const LONG_NUMERIC_RE = /^\d{8,}$/;

export type TagMap = Record<string, string>;

function utf8Bytes(s: string): number {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(s).length;
  }
  return unescape(encodeURIComponent(s)).length;
}

function normalizeKey(raw: string): string | null {
  const key = raw.trim().toLowerCase();
  if (!key || key.length > MAX_TAG_KEY_LENGTH) return null;
  if (!KEY_PATTERN.test(key)) return null;
  return key;
}

function normalizeValue(raw: unknown): string | null {
  if (raw == null) return null;
  const value = String(raw).trim();
  if (!value) return null;
  return value.length <= MAX_TAG_VALUE_LENGTH
    ? value
    : value.slice(0, MAX_TAG_VALUE_LENGTH);
}

/**
 * Sanitize a tag map: lowercase keys, charset, limits, size budget.
 * Invalid entries are dropped (never throws).
 */
export function normalizeTags(
  tags: Record<string, unknown> | null | undefined,
): TagMap {
  if (!tags) return {};
  const result: TagMap = {};
  let totalBytes = 0;

  for (const [rawKey, rawValue] of Object.entries(tags)) {
    if (Object.keys(result).length >= MAX_TAGS_PER_EVENT) break;
    const key = normalizeKey(rawKey);
    if (!key) continue;
    const value = normalizeValue(rawValue);
    if (value == null) continue;

    if (result[key] != null) {
      totalBytes -= utf8Bytes(key) + utf8Bytes(result[key]);
    }
    const entryBytes = utf8Bytes(key) + utf8Bytes(value);
    if (totalBytes + entryBytes > MAX_TAG_TOTAL_UTF8_BYTES) continue;

    result[key] = value;
    totalBytes += entryBytes;
  }

  return result;
}

/** Merge tag maps left-to-right; later keys win. Result is normalized. */
export function mergeTags(...parts: Array<TagMap | undefined | null>): TagMap {
  const merged: TagMap = {};
  for (const part of parts) {
    if (!part) continue;
    Object.assign(merged, part);
  }
  return normalizeTags(merged);
}

export function looksHighCardinalityValue(value: string): boolean {
  return UUID_RE.test(value) || EMAIL_RE.test(value) || LONG_NUMERIC_RE.test(value);
}

/**
 * Warn in non-production when tags look high-cardinality.
 * No-op when `environment` is production or warnings are disabled.
 */
export function warnSuspiciousTags(
  tags: TagMap,
  environment: string | undefined,
): void {
  if (!environment || environment === 'production') return;
  if (typeof console === 'undefined' || typeof console.warn !== 'function') {
    return;
  }

  for (const [key, value] of Object.entries(tags)) {
    if (HIGH_CARDINALITY_TAG_KEYS.has(key)) {
      console.warn(
        `@newtalaria/browser: Tag "${key}" appears to have high cardinality. ` +
          'Consider moving it to context/extra.',
      );
      continue;
    }
    if (looksHighCardinalityValue(value)) {
      console.warn(
        `@newtalaria/browser: Tag "${key}" value looks high-cardinality. ` +
          'Consider moving it to context/extra.',
      );
    }
  }
}

/** Reserved / preferred facet keys (conventions, not a closed enum). */
export const RESERVED_TAG_KEYS = [
  'service',
  'platform',
  'feature',
  'operation',
  'component',
  'runtime',
  'runtime_version',
] as const;
