import { record } from 'rrweb';
import { sanitizeNetworkUrl } from './privacy.js';
import type { FailedRequestStatusCode } from '../types.js';
import {
  classifyTransportFailure,
  describeUnknownError,
} from '../utils/network_error.js';

/**
 * Fetch / XHR instrumentation for replay breadcrumbs and optional error promotion.
 *
 * Policy (see package README): always emit `talaria-network` breadcrumbs; promote
 * to Talaria events only for same-origin or `networkErrorOrigins` (never invent
 * a `cors` failure kind from status 0 / Failed to fetch).
 */

/** How the request was issued. */
export type NetworkTransport = 'fetch' | 'xhr';

/**
 * Failure classification for network telemetry.
 * `cors` is intentionally absent — browsers do not expose CORS reliably
 * (status 0 / Failed to fetch cover many causes).
 */
export type NetworkFailureKind = 'http' | 'network' | 'abort' | 'timeout';

/** Same-origin vs cross-origin relative to the page. */
export type NetworkParty = 'first_party' | 'third_party';

export type Teardown = () => void;

/**
 * Fire when the document becomes visible again (tab focus) or is restored
 * from the back/forward cache. Used to refresh the rrweb paint base after
 * background throttling would have skipped periodic checkouts.
 */
export function installVisibilityResumeHook(onResume: () => void): Teardown {
  if (typeof document === 'undefined') {
    return () => {};
  }

  const onVisibility = () => {
    if (document.visibilityState === 'visible') {
      onResume();
    }
  };
  const onPageShow = (event: PageTransitionEvent) => {
    // Normal load also fires pageshow — only bfcache restore needs a refresh.
    if (event.persisted) {
      onResume();
    }
  };

  document.addEventListener('visibilitychange', onVisibility);
  if (typeof window !== 'undefined') {
    window.addEventListener('pageshow', onPageShow);
  }

  return () => {
    document.removeEventListener('visibilitychange', onVisibility);
    if (typeof window !== 'undefined') {
      window.removeEventListener('pageshow', onPageShow);
    }
  };
}

export interface NetworkMeta {
  method: string;
  /** Sanitized request URL (origin + pathname; query stripped by default). */
  url: string;
  /** Request origin (scheme + host + port). */
  origin?: string;
  hostname?: string;
  pathname?: string;
  /** Only when query capture is enabled. */
  search?: string;
  status?: number;
  durationMs?: number;
  ok?: boolean;
  transport?: NetworkTransport;
  /** Present on transport failures (fetch reject / XHR status 0). */
  errorName?: string;
  errorMessage?: string;
  aborted?: boolean;
  failureKind?: NetworkFailureKind;
  /** Same-origin (`first_party`) vs cross-origin (`third_party`). */
  party?: NetworkParty;
}

export interface ConsoleHookOptions {
  /** Fired after the rrweb `talaria-console` custom event is recorded. */
  onConsole?: (info: { level: string; message: string }) => void;
}

export interface NetworkHookOptions {
  /** Still emit rrweb breadcrumbs for all requests. */
  onNetwork?: (meta: NetworkMeta) => void;
  /**
   * Called before fetch/XHR is issued. Return headers to merge (existing
   * keys on the request are not overwritten). Used for W3C `traceparent`.
   */
  prepareRequest?: (info: {
    method: string;
    rawUrl: string;
  }) => { headers?: Record<string, string> } | void;
  /**
   * Called when a completed HTTP response should become a Talaria event
   * (status matches `failedRequestStatusCodes`).
   */
  onFailedRequest?: (meta: NetworkMeta & { status: number }) => void;
  /**
   * Called when a transport failure should become a Talaria event
   * (fetch reject / XHR status 0; never AbortError).
   */
  onNetworkError?: (meta: NetworkMeta) => void;
  captureFailedRequests?: boolean;
  /** Promote transport failures for first-party / allowlisted origins (default `true`). */
  captureNetworkErrors?: boolean;
  /**
   * Extra origins eligible for error promotion (exact origin strings).
   * Same-origin is always eligible. `['*']` promotes all origins.
   */
  networkErrorOrigins?: string[];
  /**
   * Override page origin (tests / non-browser). Defaults to `location.origin`.
   */
  pageOrigin?: string;
  /**
   * Keep URL query strings in network telemetry (after sensitive-key redaction).
   * Default `false`. Prefer `captureRequestQueryParameters` (same meaning).
   */
  includeNetworkUrlQuery?: boolean;
  /** Alias of `includeNetworkUrlQuery` — privacy-preserving default is `false`. */
  captureRequestQueryParameters?: boolean;
  failedRequestStatusCodes?: FailedRequestStatusCode[];
  failedRequestIgnoreUrls?: string[];
  /** SDK base URL — requests under this host + /events|/replays|/spans are never promoted. */
  talariaBaseUrl?: string;
}

function serializeConsoleArg(arg: unknown): unknown {
  if (arg instanceof Error) {
    return { name: arg.name, message: arg.message, stack: arg.stack };
  }
  return arg;
}

function formatConsoleArg(arg: unknown): string {
  if (arg == null) return String(arg);
  if (typeof arg === 'string') return arg;
  if (typeof arg === 'number' || typeof arg === 'boolean') return String(arg);
  if (arg instanceof Error) {
    return arg.stack || `${arg.name}: ${arg.message}`;
  }
  if (typeof arg === 'object' && arg !== null && 'name' in arg && 'message' in arg) {
    const err = arg as { name?: unknown; message?: unknown; stack?: unknown };
    if (typeof err.stack === 'string' && err.stack) return err.stack;
    return `${String(err.name)}: ${String(err.message)}`;
  }
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

function safeSerialize(args: unknown[]): string {
  try {
    return JSON.stringify(args.map(serializeConsoleArg));
  } catch {
    return '[unserializable]';
  }
}

function consoleMessage(args: unknown[]): string {
  return args.map(formatConsoleArg).join(' ').slice(0, 4000);
}

/** Mirror console output into rrweb as `talaria-console` custom events. */
export function installConsoleHook(options: ConsoleHookOptions = {}): Teardown {
  const levels = ['log', 'info', 'warn', 'error', 'debug'] as const;
  const originals: Partial<Record<(typeof levels)[number], (...args: unknown[]) => void>> = {};

  for (const level of levels) {
    const original = console[level].bind(console);
    originals[level] = original;
    console[level] = (...args: unknown[]) => {
      try {
        const serializedArgs = safeSerialize(args).slice(0, 4000);
        const message = consoleMessage(args);
        record.addCustomEvent('talaria-console', {
          level,
          // `message` is what the replay sidebar displays; `args` kept for tooling.
          message,
          args: serializedArgs,
          timestamp: Date.now(),
        });
        options.onConsole?.({ level, message });
      } catch {
        // ignore recording failures
      }
      original(...args);
    };
  }

  return () => {
    for (const level of levels) {
      const original = originals[level];
      if (original) console[level] = original as typeof console.log;
    }
  };
}

function emitNetwork(meta: NetworkMeta): void {
  try {
    record.addCustomEvent('talaria-network', {
      ...meta,
      timestamp: Date.now(),
    });
  } catch {
    // ignore
  }
}

export function statusMatches(
  status: number,
  codes: FailedRequestStatusCode[],
): boolean {
  for (const entry of codes) {
    if (typeof entry === 'number') {
      if (status === entry) return true;
    } else if (Array.isArray(entry) && entry.length >= 2) {
      const [min, max] = entry;
      if (status >= min && status <= max) return true;
    }
  }
  return false;
}

/** Shared ignore list for HTTP + network failure promotion. */
export function buildFailedRequestIgnoreUrls(
  failedRequestIgnoreUrls: string[],
  talariaBaseUrl?: string,
): string[] {
  const ignore = [...failedRequestIgnoreUrls];
  const base = (talariaBaseUrl ?? '').replace(/\/+$/, '');
  if (base) {
    ignore.push(`${base}/events/`, `${base}/replays/`, `${base}/spans/`);
  }
  // Relative or absolute Talaria RPC paths
  ignore.push(
    '/events/ingest',
    '/events/ingestBatch',
    '/replays/',
    '/spans/',
  );
  return ignore;
}

export function urlMatchesIgnoreList(url: string, ignoreUrls: string[]): boolean {
  const lower = (url || '').toLowerCase();
  for (const part of ignoreUrls) {
    if (part && lower.includes(part.toLowerCase())) return true;
  }
  return false;
}

/** Normalize an allowlist entry to an origin string (`https://host:port`). */
export function normalizeNetworkOrigin(raw: string): string {
  const trimmed = (raw || '').trim();
  if (!trimmed || trimmed === '*') return trimmed;
  try {
    return new URL(trimmed).origin;
  } catch {
    try {
      return new URL(`https://${trimmed}`).origin;
    } catch {
      return trimmed.replace(/\/+$/, '');
    }
  }
}

export function resolvePageOrigin(pageOrigin?: string): string {
  if (pageOrigin) {
    try {
      return new URL(pageOrigin).origin;
    } catch {
      return pageOrigin.replace(/\/+$/, '');
    }
  }
  if (typeof location !== 'undefined' && location.origin) {
    return location.origin;
  }
  return '';
}

/** Resolve the request origin from a (possibly relative) URL. */
export function resolveRequestOrigin(
  rawUrl: string,
  pageOrigin?: string,
): string {
  const base =
    pageOrigin ||
    (typeof location !== 'undefined' ? location.href : undefined);
  try {
    return new URL(rawUrl, base).origin;
  } catch {
    return '';
  }
}

/**
 * Whether a request origin may be promoted to an error event.
 * Same-origin and `networkErrorOrigins` entries (or `*`) are allowed.
 */
export function isAllowedNetworkOrigin(
  requestOrigin: string,
  opts: { networkErrorOrigins: string[]; pageOrigin?: string },
): boolean {
  if (!requestOrigin) return false;
  const allow = opts.networkErrorOrigins.map(normalizeNetworkOrigin);
  if (allow.includes('*')) return true;
  const page = resolvePageOrigin(opts.pageOrigin);
  if (page && requestOrigin === page) return true;
  return allow.includes(requestOrigin);
}

export function classifyNetworkParty(
  requestOrigin: string,
  pageOrigin?: string,
): NetworkParty {
  const page = resolvePageOrigin(pageOrigin);
  if (page && requestOrigin && requestOrigin === page) return 'first_party';
  return 'third_party';
}

/** HTTP success = 2xx (aligned for fetch and XHR). */
export function isHttpOkStatus(status: number): boolean {
  return status >= 200 && status < 300;
}

export function shouldPromoteFailedRequest(
  meta: NetworkMeta,
  opts: {
    captureFailedRequests: boolean;
    failedRequestStatusCodes: FailedRequestStatusCode[];
    failedRequestIgnoreUrls: string[];
    networkErrorOrigins?: string[];
    pageOrigin?: string;
    talariaBaseUrl?: string;
  },
): meta is NetworkMeta & { status: number } {
  if (!opts.captureFailedRequests) return false;
  if (typeof meta.status !== 'number' || Number.isNaN(meta.status)) return false;
  // status 0 is a transport failure, not an HTTP code to match ranges against
  if (meta.status === 0) return false;
  if (!statusMatches(meta.status, opts.failedRequestStatusCodes)) return false;

  const ignore = buildFailedRequestIgnoreUrls(
    opts.failedRequestIgnoreUrls,
    opts.talariaBaseUrl,
  );
  if (urlMatchesIgnoreList(meta.url || '', ignore)) return false;

  const requestOrigin =
    meta.origin || resolveRequestOrigin(meta.url || '', opts.pageOrigin);
  if (
    !isAllowedNetworkOrigin(requestOrigin, {
      networkErrorOrigins: opts.networkErrorOrigins ?? [],
      pageOrigin: opts.pageOrigin,
    })
  ) {
    return false;
  }

  return true;
}

/**
 * Promote fetch rejects / XHR status-0 failures (offline, DNS, blocked, etc.).
 * Abort is never promoted; timeout may be promoted as `failureKind: timeout`.
 * Third-party origins are skipped unless allowlisted (or `*`).
 */
export function shouldPromoteNetworkError(
  meta: NetworkMeta,
  opts: {
    captureNetworkErrors: boolean;
    failedRequestIgnoreUrls: string[];
    networkErrorOrigins?: string[];
    pageOrigin?: string;
    talariaBaseUrl?: string;
  },
): boolean {
  if (!opts.captureNetworkErrors) return false;
  if (meta.aborted || meta.failureKind === 'abort') return false;
  if (meta.failureKind !== 'network' && meta.failureKind !== 'timeout') {
    return false;
  }

  const ignore = buildFailedRequestIgnoreUrls(
    opts.failedRequestIgnoreUrls,
    opts.talariaBaseUrl,
  );
  if (urlMatchesIgnoreList(meta.url || '', ignore)) return false;

  const requestOrigin =
    meta.origin || resolveRequestOrigin(meta.url || '', opts.pageOrigin);
  if (
    !isAllowedNetworkOrigin(requestOrigin, {
      networkErrorOrigins: opts.networkErrorOrigins ?? [],
      pageOrigin: opts.pageOrigin,
    })
  ) {
    return false;
  }

  return true;
}

export function enrichNetworkMeta(meta: NetworkMeta): NetworkMeta {
  const hasHttpStatus =
    typeof meta.status === 'number' &&
    !Number.isNaN(meta.status) &&
    meta.status > 0;

  if (hasHttpStatus) {
    return {
      ...meta,
      failureKind: meta.ok === false ? 'http' : meta.failureKind,
    };
  }

  // Resolved opaque / status-0 responses without an error signal are not failures.
  const hasTransportSignal =
    !!meta.errorName ||
    !!meta.errorMessage ||
    !!meta.aborted ||
    meta.failureKind === 'abort' ||
    meta.failureKind === 'timeout' ||
    meta.failureKind === 'network';

  if (hasTransportSignal) {
    const failureKind =
      meta.failureKind === 'abort' ||
      meta.failureKind === 'timeout' ||
      meta.failureKind === 'network'
        ? meta.failureKind
        : classifyTransportFailure({
            aborted: meta.aborted,
            errorName: meta.errorName,
          });
    return {
      ...meta,
      failureKind,
      aborted: meta.aborted ?? failureKind === 'abort',
    };
  }

  return meta;
}

/** Apply privacy sanitization to a raw request URL for network meta. */
export function networkUrlParts(
  rawUrl: string,
  includeQuery: boolean,
  pageOrigin?: string,
): Pick<NetworkMeta, 'url' | 'origin' | 'hostname' | 'pathname' | 'search'> {
  const baseHref =
    pageOrigin ||
    (typeof location !== 'undefined' ? location.href : undefined);
  const parts = sanitizeNetworkUrl(rawUrl, { includeQuery, baseHref });
  const origin = resolveRequestOrigin(rawUrl, pageOrigin);
  return {
    url: parts.url,
    origin: origin || undefined,
    hostname: parts.hostname,
    pathname: parts.pathname,
    ...(parts.search ? { search: parts.search } : {}),
  };
}

/**
 * Merge extra headers onto a fetch call without overwriting existing keys.
 */
export function mergeRequestHeaders(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  extra: Record<string, string>,
): { input: RequestInfo | URL; init?: RequestInit } {
  const keys = Object.keys(extra);
  if (keys.length === 0) return { input, init };

  const existing = (name: string): boolean => {
    const lower = name.toLowerCase();
    if (init?.headers) {
      try {
        const headers = new Headers(init.headers);
        if (headers.has(lower)) return true;
      } catch {
        // ignore invalid header bag
      }
    }
    if (typeof Request !== 'undefined' && input instanceof Request) {
      try {
        if (input.headers.has(lower)) return true;
      } catch {
        // ignore
      }
    }
    return false;
  };

  const toAdd: Record<string, string> = {};
  for (const [key, value] of Object.entries(extra)) {
    if (!existing(key)) toAdd[key] = value;
  }
  if (Object.keys(toAdd).length === 0) return { input, init };

  if (init) {
    const headers = new Headers(
      init.headers ??
        (typeof Request !== 'undefined' && input instanceof Request
          ? input.headers
          : undefined),
    );
    for (const [key, value] of Object.entries(toAdd)) headers.set(key, value);
    return { input, init: { ...init, headers } };
  }

  if (typeof Request !== 'undefined' && input instanceof Request) {
    const headers = new Headers(input.headers);
    for (const [key, value] of Object.entries(toAdd)) headers.set(key, value);
    return { input: new Request(input, { headers }), init };
  }

  return { input, init: { headers: toAdd } };
}

/** Capture fetch / XHR metadata (no bodies, no auth headers); optionally promote failures. */
export function installNetworkHook(options: NetworkHookOptions = {}): Teardown {
  const originalFetch = typeof fetch === 'function' ? fetch.bind(globalThis) : null;
  const XHR = typeof XMLHttpRequest !== 'undefined' ? XMLHttpRequest : null;
  const originalOpen = XHR?.prototype.open;
  const originalSend = XHR?.prototype.send;

  const matchOpts = {
    captureFailedRequests: options.captureFailedRequests ?? true,
    captureNetworkErrors: options.captureNetworkErrors ?? true,
    failedRequestStatusCodes: options.failedRequestStatusCodes ?? [[500, 599]],
    failedRequestIgnoreUrls: options.failedRequestIgnoreUrls ?? [],
    networkErrorOrigins: options.networkErrorOrigins ?? [],
    pageOrigin: options.pageOrigin,
    talariaBaseUrl: options.talariaBaseUrl,
  };
  const includeQuery =
    options.captureRequestQueryParameters ??
    options.includeNetworkUrlQuery ??
    false;

  const handleMeta = (meta: NetworkMeta & { rawUrl: string }) => {
    const { rawUrl, ...rest } = meta;
    const parts = networkUrlParts(rawUrl, includeQuery, matchOpts.pageOrigin);
    const party = classifyNetworkParty(
      parts.origin || '',
      matchOpts.pageOrigin,
    );
    const enriched = enrichNetworkMeta({
      ...rest,
      ...parts,
      party,
    });
    // Never let breadcrumb/promotion failures mask the original fetch error.
    try {
      emitNetwork(enriched);
      options.onNetwork?.(enriched);
      if (shouldPromoteFailedRequest(enriched, matchOpts)) {
        options.onFailedRequest?.(enriched);
      } else if (shouldPromoteNetworkError(enriched, matchOpts)) {
        options.onNetworkError?.(enriched);
      }
    } catch {
      // ignore instrumentation failures
    }
  };

  if (originalFetch) {
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const started = Date.now();
      const method = (
        init?.method ?? (input instanceof Request ? input.method : 'GET')
      ).toUpperCase();
      const rawUrl =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      let nextInput = input;
      let nextInit = init;
      try {
        const prepared = options.prepareRequest?.({ method, rawUrl });
        if (prepared?.headers) {
          const merged = mergeRequestHeaders(input, init, prepared.headers);
          nextInput = merged.input;
          nextInit = merged.init;
        }
      } catch {
        // never block the request
      }

      try {
        const response = await originalFetch(nextInput, nextInit);
        const opaque = response.type === 'opaque' || response.type === 'opaqueredirect';
        handleMeta({
          method,
          rawUrl,
          url: rawUrl,
          transport: 'fetch',
          status: response.status,
          durationMs: Date.now() - started,
          // Opaque responses resolve successfully with status 0 — not a failure.
          ok: opaque ? true : response.ok,
        });
        return response;
      } catch (error) {
        const described = describeUnknownError(error);
        const failureKind = classifyTransportFailure(described);
        handleMeta({
          method,
          rawUrl,
          url: rawUrl,
          transport: 'fetch',
          durationMs: Date.now() - started,
          ok: false,
          errorName: described.errorName,
          errorMessage: described.errorMessage,
          aborted: described.aborted,
          failureKind,
        });
        throw error;
      }
    };
  }

  if (XHR && originalOpen && originalSend) {
    type PatchedXhr = XMLHttpRequest & {
      __talariaMethod?: string;
      __talariaUrl?: string;
      __talariaStarted?: number;
      __talariaTimedOut?: boolean;
      __talariaAborted?: boolean;
    };

    XHR.prototype.open = function (
      this: PatchedXhr,
      method: string,
      url: string | URL,
      async?: boolean,
      username?: string | null,
      password?: string | null,
    ) {
      this.__talariaMethod = String(method).toUpperCase();
      this.__talariaUrl = String(url);
      return originalOpen.call(this, method, url, async ?? true, username, password);
    };

    XHR.prototype.send = function (this: PatchedXhr, body?: Document | XMLHttpRequestBodyInit | null) {
      this.__talariaStarted = Date.now();
      this.__talariaTimedOut = false;
      this.__talariaAborted = false;
      try {
        const prepared = options.prepareRequest?.({
          method: this.__talariaMethod ?? 'GET',
          rawUrl: this.__talariaUrl ?? '',
        });
        if (prepared?.headers) {
          for (const [key, value] of Object.entries(prepared.headers)) {
            try {
              this.setRequestHeader(key, value);
            } catch {
              // already sent / forbidden
            }
          }
        }
      } catch {
        // never block the request
      }
      this.addEventListener(
        'timeout',
        () => {
          this.__talariaTimedOut = true;
        },
        { once: true },
      );
      this.addEventListener(
        'abort',
        () => {
          this.__talariaAborted = true;
        },
        { once: true },
      );
      const onDone = () => {
        const status = this.status;
        const transportFail = status === 0;
        const rawUrl = this.__talariaUrl ?? '';
        const aborted = !!this.__talariaAborted;
        const timedOut = !!this.__talariaTimedOut;
        const failureKind = transportFail
          ? classifyTransportFailure({ aborted, timedOut })
          : undefined;
        const errorName = transportFail
          ? failureKind === 'abort'
            ? 'AbortError'
            : failureKind === 'timeout'
              ? 'TimeoutError'
              : 'NetworkError'
          : undefined;
        const errorMessage = transportFail
          ? failureKind === 'abort'
            ? 'XMLHttpRequest aborted'
            : failureKind === 'timeout'
              ? 'XMLHttpRequest timed out'
              : 'XMLHttpRequest failed (status 0)'
          : undefined;
        handleMeta({
          method: this.__talariaMethod ?? 'GET',
          rawUrl,
          url: rawUrl,
          transport: 'xhr',
          status,
          durationMs: Date.now() - (this.__talariaStarted ?? Date.now()),
          ok: isHttpOkStatus(status),
          ...(transportFail
            ? {
                failureKind,
                errorName,
                errorMessage,
                aborted,
              }
            : {}),
        });
      };
      this.addEventListener('loadend', onDone, { once: true });
      return originalSend.call(this, body);
    };
  }

  return () => {
    if (originalFetch) globalThis.fetch = originalFetch;
    if (XHR && originalOpen) XHR.prototype.open = originalOpen;
    if (XHR && originalSend) XHR.prototype.send = originalSend;
  };
}
