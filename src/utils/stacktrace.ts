import type { StackFrame, StackTrace } from '../types.js';

/** V8 / Chrome: `at fn (url:line:col)` or `at url:line:col`. */
const V8_FRAME =
  /^\s*at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?\s*$/;

/** V8 bare: `at Object.method` / `at <anonymous>` (no location). */
const V8_FRAME_BARE = /^\s*at\s+(.+)\s*$/;

/** Firefox / Safari: `fn@url:line:col` or `@url:line:col`. */
const GECKO_FRAME = /^\s*(?:(.*?)@)?(\S+):(\d+):(\d+)\s*$/;

const EXTENSION_URL =
  /(?:chrome|moz|safari|safari-web|ms-browser)-extension:\/\//i;

/** Options for classifying stack frames as in-app. */
export interface InAppFrameOptions {
  /** Page origin (e.g. `https://www.example.com`). Same-origin frames are in-app. */
  pageOrigin?: string;
  /** Extra origins treated as app code (exact origin strings, e.g. asset CDN). */
  inAppOrigins?: string[];
  /** Path substrings or RegExps that force `inApp: true`. */
  allowUrls?: Array<string | RegExp>;
  /** Path substrings or RegExps that force `inApp: false`. */
  denyUrls?: Array<string | RegExp>;
}

/**
 * Parse a V8 / Chrome / Firefox / Safari `Error.stack` string into
 * structured frames. Returns frames in **oldest → newest** order
 * (crash site last).
 */
export function parseStackTrace(
  stack?: string | null,
  inAppOptions?: InAppFrameOptions,
): StackTrace | undefined {
  if (!stack || !stack.trim()) return undefined;

  const parsed: StackFrame[] = [];
  for (const line of stack.split('\n')) {
    const frame = parseStackLine(line, inAppOptions);
    if (frame) parsed.push(frame);
  }

  if (parsed.length === 0) return undefined;

  // V8 emits newest-first; wire contract is oldest → newest.
  parsed.reverse();
  return { frames: parsed };
}

/** Parse a single V8 or Gecko stack line into a frame, or null if not a frame. */
export function parseStackLine(
  line: string,
  inAppOptions?: InAppFrameOptions,
): StackFrame | null {
  if (/^\s*at\s+/.test(line)) {
    const v8 = V8_FRAME.exec(line);
    if (v8) {
      return frameFromParts(v8[1], v8[2], v8[3], v8[4], inAppOptions);
    }

    const bare = V8_FRAME_BARE.exec(line);
    if (bare) {
      const functionName = cleanFunction(bare[1]);
      if (!functionName) return null;
      return {
        functionName,
        inApp: false,
        platform: 'javascript',
      };
    }

    return null;
  }

  const gecko = GECKO_FRAME.exec(line);
  if (!gecko) return null;
  const absPath = gecko[2] ?? '';
  // Message lines like `Error: boom` must not become frames.
  if (
    !absPath ||
    /^(?:error|typeerror|referenceerror|syntaxerror)$/i.test(absPath)
  ) {
    return null;
  }
  if (
    !/https?:\/\//i.test(absPath) &&
    !absPath.includes('/') &&
    !absPath.includes('\\')
  ) {
    return null;
  }
  return frameFromParts(gecko[1], absPath, gecko[3], gecko[4], inAppOptions);
}

function frameFromParts(
  rawFunction: string | undefined,
  rawPath: string | undefined,
  rawLine: string | undefined,
  rawCol: string | undefined,
  inAppOptions?: InAppFrameOptions,
): StackFrame {
  const absPath = stripQuery(rawPath ?? '');
  const lineno = Number.parseInt(rawLine ?? '', 10);
  const colno = Number.parseInt(rawCol ?? '', 10);
  return {
    functionName: cleanFunction(rawFunction),
    absPath: absPath || undefined,
    filename: basename(absPath),
    lineno: Number.isFinite(lineno) ? lineno : undefined,
    colno: Number.isFinite(colno) ? colno : undefined,
    inApp: isInAppFrame(absPath, inAppOptions),
    platform: 'javascript',
  };
}

/**
 * Apply `window.onerror` (or similar) location onto the newest frame,
 * or synthesize a single frame when the stack had none.
 */
export function applySourceLocation(
  stacktrace: StackTrace | undefined,
  source?: { filename?: string; lineno?: number; colno?: number },
  inAppOptions?: InAppFrameOptions,
): StackTrace | undefined {
  if (!source) return stacktrace;
  const filename = source.filename?.trim() || undefined;
  const lineno =
    typeof source.lineno === 'number' && source.lineno > 0
      ? source.lineno
      : undefined;
  const colno =
    typeof source.colno === 'number' && source.colno >= 0
      ? source.colno
      : undefined;
  if (!filename && lineno == null && colno == null) return stacktrace;

  if (!stacktrace || stacktrace.frames.length === 0) {
    if (!filename && lineno == null) return stacktrace;
    const absPath = filename;
    return {
      frames: [
        {
          filename: absPath ? basename(absPath) : undefined,
          absPath,
          lineno,
          colno,
          inApp: absPath ? isInAppFrame(absPath, inAppOptions) : true,
          platform: 'javascript',
        },
      ],
    };
  }

  const frames = stacktrace.frames.slice();
  const top = { ...frames[frames.length - 1]! };
  if (filename) {
    top.absPath = filename;
    top.filename = basename(filename);
    top.inApp = isInAppFrame(filename, inAppOptions);
  }
  if (lineno != null) top.lineno = lineno;
  if (colno != null) top.colno = colno;
  frames[frames.length - 1] = top;
  return { ...stacktrace, frames };
}

/**
 * inApp heuristics: same-origin (or allowlisted) app code, not vendors/CDN/SDK.
 */
export function isInAppFrame(
  path: string,
  options?: InAppFrameOptions,
): boolean {
  const lower = path.toLowerCase();
  if (!lower) return true;

  if (lower.includes('node_modules')) return false;
  if (EXTENSION_URL.test(path) || lower.includes('webkit-masked-url://')) {
    return false;
  }
  // Talaria browser SDK itself is never app code (CDN or bundled).
  if (lower.includes('@newtalaria/browser')) return false;

  if (matchesUrlList(path, options?.denyUrls)) return false;
  if (matchesUrlList(path, options?.allowUrls)) return true;

  const frameOrigin = tryParseOrigin(path);
  if (frameOrigin != null) {
    const pageOrigin = normalizeOrigin(options?.pageOrigin);
    if (pageOrigin && frameOrigin === pageOrigin) return true;
    const extra = options?.inAppOrigins ?? [];
    for (const origin of extra) {
      if (normalizeOrigin(origin) === frameOrigin) return true;
    }
    return false;
  }

  // Relative / non-URL paths (e.g. webpack://) — treat as app unless denied.
  return true;
}

function matchesUrlList(
  path: string,
  patterns: Array<string | RegExp> | undefined,
): boolean {
  if (!patterns || patterns.length === 0) return false;
  for (const pattern of patterns) {
    if (typeof pattern === 'string') {
      if (pattern && path.includes(pattern)) return true;
    } else if (pattern.test(path)) {
      return true;
    }
  }
  return false;
}

function tryParseOrigin(path: string): string | null {
  if (!/^https?:\/\//i.test(path)) return null;
  try {
    return new URL(path).origin;
  } catch {
    return null;
  }
}

/** Normalize an origin or URL to `scheme://host[:port]`, or null if unknown. */
function normalizeOrigin(origin: string | undefined): string | null {
  if (!origin || !origin.trim()) return null;
  const trimmed = origin.trim();
  try {
    if (/^https?:\/\//i.test(trimmed)) {
      return new URL(trimmed).origin;
    }
    // Exact origin strings are compared as-is when they aren't parseable URLs.
    return trimmed;
  } catch {
    return trimmed;
  }
}

/** Page origin from `window.location.origin` or a full page URL. */
export function resolvePageOrigin(originOrUrl?: string): string | undefined {
  return normalizeOrigin(originOrUrl) ?? undefined;
}

function cleanFunction(raw: string | undefined): string | undefined {
  if (raw == null) return undefined;
  const value = raw.trim();
  return value.length === 0 ? undefined : value;
}

function stripQuery(path: string): string {
  const q = path.indexOf('?');
  return q >= 0 ? path.slice(0, q) : path;
}

function basename(path: string): string | undefined {
  if (!path) return undefined;
  const normalized = stripQuery(path);
  const parts = normalized.split(/[/\\]/);
  const last = parts[parts.length - 1];
  return last || normalized;
}
