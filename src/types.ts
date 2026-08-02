/** Severity levels accepted by Talaria event ingest. */
export type SeverityLevel = 'debug' | 'info' | 'warning' | 'error' | 'fatal';

/** Environments accepted by Talaria wire enums. */
export type Environment = 'production' | 'staging' | 'development';

/** Single status or inclusive [min, max] range. */
export type FailedRequestStatusCode = number | [number, number];

export interface TalariaInitOptions {
  /**
   * Serverpod host, e.g. `http://localhost:8080` or `https://ingest.example.com`.
   * Alias of `baseUrl`.
   */
  dsn?: string;
  /** Same as `dsn` — prefer one of the two. */
  baseUrl?: string;
  /** Project API key (`tal_live_…`). */
  apiKey: string;
  environment: Environment | string;
  release?: string;
  /** Fraction of sessions that upload continuously (0–1). Default `0`. */
  replaysSessionSampleRate?: number;
  /**
   * Fraction of errors that promote the ring buffer to an uploaded replay (0–1).
   * Default `1`. Ignored once `replaysSessionSampleRate` already enabled upload.
   */
  replaysOnErrorSampleRate?: number;
  /**
   * How long to keep uploading after an error-sample hit (ms).
   * - Default `15000` (~15s): cheap error clip, then finish and return to buffer mode.
   * - `0`: Sentry-like — continue until the 5-minute max duration or page unload.
   */
  replaysErrorAfterMs?: number;
  /** Passed to rrweb. Default `true`. */
  maskAllInputs?: boolean;
  /**
   * Embed accessible stylesheet rules into the snapshot (rrweb `inlineStylesheet`).
   * Default `false` (smaller payloads; player re-fetches public CSS hrefs).
   * Enable for auth-gated UIs (e.g. CMS admin) so same-origin CSS is captured while logged in.
   * Cross-origin sheets without CORS still cannot be inlined.
   */
  inlineStylesheet?: boolean;
  /** CSS selectors blocked from the DOM snapshot (plus `[data-talaria-mask]`). */
  blockSelector?: string;
  /** Optional app user id attached to events / replay start. */
  userId?: string;
  /** Tags merged into every captured event (per-call tags win on key conflict). */
  tags?: Record<string, string>;
  /**
   * Preferred low-cardinality dimensions (optional conventions):
   * `service`, `platform`, `feature`, `operation`, `component`, `runtime`,
   * `runtime_version`. Do not put environment/release or high-cardinality IDs here.
   */
  /** Disable automatic `window` / `unhandledrejection` handlers. */
  disableDefaultIntegrations?: boolean;
  /**
   * Promote matching HTTP fetch/XHR failures to Talaria events for first-party /
   * allowlisted origins (not just replay breadcrumbs). Default `true`.
   */
  captureFailedRequests?: boolean;
  /**
   * Promote fetch/XHR transport failures (no HTTP status) as events for
   * first-party / allowlisted origins. Default `true`. AbortError is never promoted.
   * Third-party failures stay as replay breadcrumbs unless their origin is allowlisted.
   */
  captureNetworkErrors?: boolean;
  /**
   * Extra origins whose failed requests may be promoted (exact origin strings).
   * Same-origin is always eligible. Use `['*']` to promote all origins (not recommended).
   * Example: `['https://api.stripe.com']`.
   */
  networkErrorOrigins?: string[];
  /**
   * Keep query strings on network telemetry URLs (after sensitive-key redaction).
   * Default `false` — strips `?…` / `#…` so GA/ads identifiers are not stored.
   * Prefer `captureRequestQueryParameters`.
   */
  includeNetworkUrlQuery?: boolean;
  /**
   * Alias of `includeNetworkUrlQuery`. Privacy-preserving default is `false`.
   */
  captureRequestQueryParameters?: boolean;
  /**
   * Status codes / ranges to promote. Default `[[500, 599]]`.
   * Use `[[400, 599]]` for CMS admin (GridField/PJAX 404s).
   * Only applies to first-party / allowlisted origins.
   */
  failedRequestStatusCodes?: FailedRequestStatusCode[];
  /** Extra URL substrings that must never be promoted (Talaria ingest URLs are always ignored). */
  failedRequestIgnoreUrls?: string[];
  /**
   * Path substrings or RegExps that force stack frames `inApp: true`
   * (checked after built-in denies / denyUrls).
   */
  inAppAllowUrls?: Array<string | RegExp>;
  /**
   * Path substrings or RegExps that force stack frames `inApp: false`.
   */
  inAppDenyUrls?: Array<string | RegExp>;
  /**
   * Extra origins treated as app code for `inApp` (exact origin strings).
   * Same-origin (`window.location.origin`) is always included.
   * Example: `['https://cdn.example.com']` for CDN-hosted app bundles.
   */
  inAppOrigins?: string[];
}

/** How an exception was captured / produced (mirrors ExceptionMechanismDto). */
export interface ExceptionMechanism {
  type: string;
  handled?: boolean;
  synthetic?: boolean;
}

/**
 * Single stack frame on the wire (mirrors StackFrameDto).
 * Uses `functionName` — not `function` (reserved in Dart / Serverpod).
 */
export interface StackFrame {
  filename?: string;
  absPath?: string;
  functionName?: string;
  rawFunction?: string;
  module?: string;
  package?: string;
  platform?: string;
  lineno?: number;
  colno?: number;
  inApp?: boolean;
  instructionAddr?: string;
  symbolAddr?: string;
  imageAddr?: string;
  addrMode?: string;
  contextLine?: string;
  preContext?: string[];
  postContext?: string[];
  vars?: Record<string, string>;
  stackStart?: boolean;
}

/** Structured stacktrace (mirrors StackTraceDto). Frames are oldest → newest. */
export interface StackTrace {
  frames: StackFrame[];
  registers?: Record<string, string>;
}

/** One exception in a chain (mirrors ExceptionValueDto). */
export interface ExceptionValue {
  type?: string;
  value?: string;
  module?: string;
  threadId?: string;
  code?: string;
  mechanism?: ExceptionMechanism;
  stacktrace?: StackTrace;
}

/** First-class exception payload (mirrors ExceptionDataDto). */
export interface ExceptionData {
  values: ExceptionValue[];
}

/** Optional debug image metadata (mirrors DebugImageDto). */
export interface DebugImage {
  type?: string;
  imageAddr?: string;
  imageSize?: number;
  debugId?: string;
  debugFile?: string;
  codeId?: string;
  codeFile?: string;
  arch?: string;
}

/** Optional debug meta (mirrors DebugMetaDto). */
export interface DebugMeta {
  images?: DebugImage[];
}

export interface CaptureContext {
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  userId?: string;
  title?: string;
  /** How the exception was captured (`onerror`, `unhandledrejection`, `http`, …). */
  mechanism?: ExceptionMechanism;
  /**
   * Enrich the top (newest) stack frame — e.g. `window.onerror` location.
   * Not sent in `extra`.
   */
  source?: {
    filename?: string;
    lineno?: number;
    colno?: number;
  };
}

export interface ResolvedOptions {
  baseUrl: string;
  apiKey: string;
  /** Wire enum value after alias normalization (`test` → `staging`, etc.). */
  environment: Environment;
  release?: string;
  replaysSessionSampleRate: number;
  replaysOnErrorSampleRate: number;
  replaysErrorAfterMs: number;
  maskAllInputs: boolean;
  inlineStylesheet: boolean;
  blockSelector: string;
  userId?: string;
  tags?: Record<string, string>;
  disableDefaultIntegrations: boolean;
  captureFailedRequests: boolean;
  captureNetworkErrors: boolean;
  networkErrorOrigins: string[];
  includeNetworkUrlQuery: boolean;
  failedRequestStatusCodes: FailedRequestStatusCode[];
  failedRequestIgnoreUrls: string[];
  inAppAllowUrls: Array<string | RegExp>;
  inAppDenyUrls: Array<string | RegExp>;
  inAppOrigins: string[];
}
