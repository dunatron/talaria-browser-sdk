import type {
  CaptureContext,
  ExceptionData,
  ExceptionMechanism,
  ResolvedOptions,
  SeverityLevel,
  TalariaInitOptions,
} from './types.js';
import { createId } from './utils/id.js';
import { normalizeEnvironment } from './utils/environment.js';
import { isBrowserExtensionNoise } from './utils/browser_extension_noise.js';
import { isOpaqueCrossOriginScriptError } from './utils/opaque_script_error.js';
import { isSdkInternalNoise } from './utils/sdk_internal_noise.js';
import {
  browserContextTags,
  collectBrowserContext,
  parseBrowserContext,
  type BrowserContext,
} from './utils/browser_context.js';
import { mergeTags, warnSuspiciousTags, type TagMap } from './utils/tags.js';
import {
  applySourceLocation,
  parseStackTrace,
  resolvePageOrigin,
  type InAppFrameOptions,
} from './utils/stacktrace.js';
import { SDK_NAME, SDK_VERSION } from './sdk_meta.js';
import { ServerpodTransport } from './transport/serverpod.js';
import { ingestEvent } from './transport/events.js';
import {
  compressReplayEvents,
  finishReplay,
  ingestReplaySegment,
  startReplay,
} from './transport/replays.js';
import {
  ERROR_REPLAY_AFTER_MS,
  MAX_COMPRESSED_SEGMENT_BYTES,
  MAX_ERROR_CLIP_COMPRESSED_BYTES,
  MAX_REPLAY_DURATION_MS,
  MAX_SEGMENTS_ERROR_CLIP,
  MAX_SEGMENTS_PER_REPLAY,
  RING_BUFFER_CHECKOUT_MS,
  RRWEB_FULL_SNAPSHOT,
  SEGMENT_FLUSH_MS,
  SEGMENT_SIZE_BYTES,
  TARGET_COMPRESSED_SEGMENT_BYTES,
  SegmentBuffer,
  type RrwebEvent,
} from './replay/segment_buffer.js';
import {
  computeErrorClipDeadlineMs,
  fitCompressedPrefix,
  isErrorClipBudgetExhausted,
  paintBaseEventCount,
  planOversizedRetry,
} from './replay/fit_segment.js';
import {
  applyReplayCaptureTags,
  mergeReplayCaptureExtra,
  type ReplayCaptureFailure,
  type ReplayCaptureOutcome,
  type ReplayCaptureReason,
} from './replay/capture_outcome.js';
import { paintBaseSizeDetails } from './replay/paint_base_size.js';
import { startRecorder, type RecorderHandle } from './replay/recorder.js';
import {
  buildFailedRequestIgnoreUrls,
  installConsoleHook,
  installNetworkHook,
  installVisibilityResumeHook,
  urlMatchesIgnoreList,
  type NetworkMeta,
  type Teardown,
} from './replay/hooks.js';
import {
  isAbortError,
  isCorrelatableTransportError,
  isTimeoutError,
} from './utils/network_error.js';

const PLATFORM_JAVASCRIPT = 'javascript';

/** Keys that belong on first-class exception / stack fields — never in extra. */
const EXTRA_LOCATION_KEYS = new Set([
  'exception_class',
  'file',
  'line',
  'code',
  'filename',
  'lineno',
  'colno',
]);

export {
  computeErrorClipDeadlineMs,
  fitCompressedPrefix,
  isErrorClipBudgetExhausted,
  paintBaseEventCount,
  planOversizedRetry,
} from './replay/fit_segment.js';
export {
  MAX_SEGMENTS_ERROR_CLIP,
  MAX_ERROR_CLIP_COMPRESSED_BYTES,
  TARGET_COMPRESSED_SEGMENT_BYTES,
  MAX_COMPRESSED_SEGMENT_BYTES,
} from './replay/segment_buffer.js';
export {
  REPLAY_CAPTURE_TAG,
  REPLAY_CAPTURE_REASON_TAG,
  applyReplayCaptureTags,
  mergeReplayCaptureExtra,
} from './replay/capture_outcome.js';
export type {
  ReplayCaptureOutcome,
  ReplayCaptureReason,
  ReplayCaptureStatus,
} from './replay/capture_outcome.js';
function networkExceptionClass(failure: NetworkMeta): string {
  if (failure.failureKind === 'http') return 'HttpError';
  if (failure.failureKind === 'timeout') return 'TimeoutError';
  return 'NetworkError';
}

function networkFailureTags(failure: NetworkMeta): Record<string, string> {
  return {
    'http.method': failure.method || 'GET',
    'network.failure_kind': failure.failureKind ?? 'network',
    ...(failure.party ? { 'network.party': failure.party } : {}),
    ...(failure.transport ? { 'network.transport': failure.transport } : {}),
    ...(failure.errorName ? { 'network.error_name': failure.errorName } : {}),
  };
}

/** Structured network failure payload for event `extra`. */
function networkFailureExtra(failure: NetworkMeta): Record<string, unknown> {
  const http: Record<string, unknown> = {
    method: failure.method || 'GET',
    url: failure.url || '(unknown url)',
  };
  if (failure.origin) http.origin = failure.origin;
  if (failure.hostname) http.hostname = failure.hostname;
  if (failure.pathname) http.pathname = failure.pathname;
  if (failure.search) http.search = failure.search;
  if (typeof failure.status === 'number' && failure.status > 0) {
    http.status = failure.status;
  }
  if (failure.transport) http.transport = failure.transport;

  const fail: Record<string, unknown> = {
    kind: failure.failureKind ?? 'network',
  };
  if (failure.errorName) fail.name = failure.errorName;
  if (failure.errorMessage) fail.message = failure.errorMessage;

  const statusCode =
    typeof failure.status === 'number' && failure.status > 0
      ? failure.status
      : null;

  return {
    http,
    failure: fail,
    network: {
      party: failure.party ?? 'third_party',
      durationMs: failure.durationMs,
      aborted: failure.aborted ?? false,
      ok: failure.ok ?? false,
    },
    // Top-level for server fingerprint compatibility (status only —
    // exception type lives on first-class `exception.values[0].type`).
    status_code: statusCode,
    durationMs: failure.durationMs,
    aborted: failure.aborted ?? false,
    ok: failure.ok ?? false,
  };
}

function networkExceptionData(
  failure: NetworkMeta,
  message: string,
): ExceptionData {
  return {
    values: [
      {
        type: networkExceptionClass(failure),
        value: message,
        mechanism: {
          type: 'http',
          handled: true,
          synthetic: true,
        },
      },
    ],
  };
}

/** Drop legacy location / exception_class keys from capture extra. */
function scrubLegacyExceptionExtra(
  extra: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!extra) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(extra)) {
    if (EXTRA_LOCATION_KEYS.has(key)) continue;
    out[key] = value;
  }
  return Object.keys(out).length ? out : undefined;
}

function buildExceptionFromError(
  err: Error,
  context?: CaptureContext,
  inAppOptions?: InAppFrameOptions,
): ExceptionData {
  const mechanism: ExceptionMechanism = context?.mechanism ?? {
    type: 'generic',
    handled: true,
  };
  const stacktrace = applySourceLocation(
    parseStackTrace(err.stack, inAppOptions),
    context?.source,
    inAppOptions,
  );
  return {
    values: [
      {
        type: err.name || 'Error',
        value: err.message || err.name || 'Error',
        mechanism,
        ...(stacktrace ? { stacktrace } : {}),
      },
    ],
  };
}

function mergeNetworkFailureContext(
  context: CaptureContext | undefined,
  failure: NetworkMeta,
): CaptureContext {
  return {
    ...context,
    tags: {
      ...(context?.tags ?? {}),
      ...networkFailureTags(failure),
    },
    extra: {
      ...(context?.extra ?? {}),
      ...networkFailureExtra(failure),
    },
  };
}

function resolveOptions(options: TalariaInitOptions): ResolvedOptions {
  const baseUrl = (options.baseUrl ?? options.dsn ?? '').trim();
  if (!baseUrl) {
    throw new Error('@newtalaria/browser: init requires `dsn` or `baseUrl`');
  }
  if (!options.apiKey?.trim()) {
    throw new Error('@newtalaria/browser: init requires `apiKey`');
  }
  if (!options.environment) {
    throw new Error('@newtalaria/browser: init requires `environment`');
  }

  return {
    baseUrl,
    apiKey: options.apiKey.trim(),
    environment: normalizeEnvironment(String(options.environment)),
    release: options.release,
    replaysSessionSampleRate: clamp01(options.replaysSessionSampleRate ?? 0),
    replaysOnErrorSampleRate: clamp01(options.replaysOnErrorSampleRate ?? 1),
    replaysErrorAfterMs: normalizeErrorAfterMs(options.replaysErrorAfterMs),
    maskAllInputs: options.maskAllInputs ?? true,
    inlineStylesheet: options.inlineStylesheet ?? false,
    blockSelector: options.blockSelector ?? '',
    userId: options.userId,
    tags: mergeTags(options.tags),
    disableDefaultIntegrations: options.disableDefaultIntegrations ?? false,
    captureFailedRequests: options.captureFailedRequests ?? true,
    captureNetworkErrors: options.captureNetworkErrors ?? true,
    networkErrorOrigins: options.networkErrorOrigins ?? [],
    includeNetworkUrlQuery:
      options.captureRequestQueryParameters ??
      options.includeNetworkUrlQuery ??
      false,
    failedRequestStatusCodes: options.failedRequestStatusCodes ?? [[500, 599]],
    failedRequestIgnoreUrls: options.failedRequestIgnoreUrls ?? [],
    inAppAllowUrls: options.inAppAllowUrls ?? [],
    inAppDenyUrls: options.inAppDenyUrls ?? [],
    inAppOrigins: options.inAppOrigins ?? [],
  };
}

const RECENT_NETWORK_FAILURE_MS = 5_000;

interface RecentNetworkFailure extends NetworkMeta {
  at: number;
  promoted: boolean;
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/** `0` = continue until max duration; otherwise non-negative ms (default 15s). */
function normalizeErrorAfterMs(n: number | undefined): number {
  if (n === undefined || Number.isNaN(n) || n < 0) {
    return ERROR_REPLAY_AFTER_MS;
  }
  return Math.floor(n);
}

function levelToEventType(
  level: SeverityLevel,
): 'error' | 'warning' | 'info' | 'debug' {
  if (level === 'fatal' || level === 'error') return 'error';
  if (level === 'warning') return 'warning';
  if (level === 'debug') return 'debug';
  return 'info';
}

/** Server rejected further segments for this replay — do not retry. */
function isTerminalReplayLimitError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    msg.includes('replay exceeds max segment count') ||
    msg.includes('replay exceeds max total size') ||
    msg.includes('replay exceeds max duration') ||
    msg.includes('Replay has expired')
  );
}

/** This chunk is too big — bisect/drop; never blind-retry the same payload. */
function isOversizedSegmentError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    msg.includes('segment exceeds max compressed size') ||
    msg.includes('segment exceeds max uncompressed size') ||
    (msg.includes('HTTP 400') && msg.includes('ApiValidationException'))
  );
}

/**
 * Event ingest failures that will not succeed on retry (bad wire payload / auth).
 * Excludes 408 / 429 so transient client limits can still recover.
 */
function isPermanentIngestError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  const match = /Talaria events\/ingest(?:Batch)? failed: HTTP (\d{3})/.exec(
    msg,
  );
  if (!match) return false;
  const status = Number(match[1]);
  if (status < 400 || status >= 500) return false;
  return status !== 408 && status !== 429;
}

export class TalariaClient {
  private options: ResolvedOptions | null = null;
  private transport: ServerpodTransport | null = null;
  private replayId: string | null = null;
  private sessionId: string | null = null;
  private recorder: RecorderHandle | null = null;
  private buffer = new SegmentBuffer();
  /** Continuous upload for the whole page session (session sample hit). */
  private sessionSampled = false;
  private uploadEnabled = false;
  private startedOnServer = false;
  private finishedOnServer = false;
  private segmentIndex = 0;
  private uploadedCompressedBytes = 0;
  /** Wall clock when continuous upload began (session or error promote). */
  private uploadStartedAtMs: number | null = null;
  /** Absolute deadline for error-clip mode (not extended by later errors). */
  private errorClipDeadlineMs: number | null = null;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private errorClipTimer: ReturnType<typeof setTimeout> | null = null;
  private maxDurationTimer: ReturnType<typeof setTimeout> | null = null;
  private uploadChain: Promise<void> = Promise.resolve();
  private closed = false;
  private teardowns: Teardown[] = [];
  /**
   * Replay id that just finished with segments — kept briefly so capture can
   * attach it to the error event after budget/timer finish resets buffer mode.
   */
  private linkableReplayId: string | null = null;
  /** Last error-clip paint/upload failure (cleared on successful segment 0). */
  private lastReplayCaptureFailure: ReplayCaptureFailure | null = null;
  /** Cached once per init for event tags/extra. */
  private browserContext: BrowserContext | null = null;
  /** Prevent ingest/replay failures from being re-captured via unhandledrejection. */
  private capturing = false;
  /**
   * Set after a permanent events/ingest 4xx (bad env/auth/wire). Further
   * captures no-op so we don't spin on retries or burn error-clip replay quota.
   */
  private ingestDisabled = false;
  /** Recent fetch/XHR transport failures for correlation + dedupe. */
  private recentNetworkFailures: RecentNetworkFailure[] = [];

  init(options: TalariaInitOptions): void {
    if (this.options) {
      console.warn('@newtalaria/browser: already initialized');
      return;
    }

    this.options = resolveOptions(options);
    this.transport = new ServerpodTransport({
      baseUrl: this.options.baseUrl,
      apiKey: this.options.apiKey,
    });
    this.sessionId = createId();
    this.replayId = createId();
    this.closed = false;
    this.ingestDisabled = false;
    this.finishedOnServer = false;
    this.startedOnServer = false;
    this.segmentIndex = 0;
    this.uploadedCompressedBytes = 0;
    this.uploadStartedAtMs = null;
    this.errorClipDeadlineMs = null;
    this.linkableReplayId = null;
    this.lastReplayCaptureFailure = null;
    this.recentNetworkFailures = [];
    this.browserContext = parseBrowserContext();
    void collectBrowserContext().then((ctx) => {
      if (this.options) this.browserContext = ctx;
    });
    this.buffer = new SegmentBuffer();
    this.uploadChain = Promise.resolve();

    this.sessionSampled =
      Math.random() < this.options.replaysSessionSampleRate;
    this.uploadEnabled = this.sessionSampled;

    this.recorder = startRecorder({
      maskAllInputs: this.options.maskAllInputs,
      inlineStylesheet: this.options.inlineStylesheet,
      blockSelector: this.options.blockSelector,
      // Buffer/error path: keep a FullSnapshot inside the ~60s ring. Session
      // sample uploads continuously so periodic checkouts are skipped (size).
      checkoutEveryNms: this.sessionSampled
        ? undefined
        : RING_BUFFER_CHECKOUT_MS,
      onEvent: (event) => this.onRrwebEvent(event),
    });

    this.teardowns.push(
      installConsoleHook(),
      installNetworkHook({
        captureFailedRequests: this.options.captureFailedRequests,
        captureNetworkErrors: this.options.captureNetworkErrors,
        networkErrorOrigins: this.options.networkErrorOrigins,
        pageOrigin:
          typeof location !== 'undefined' ? location.origin : undefined,
        includeNetworkUrlQuery: this.options.includeNetworkUrlQuery,
        failedRequestStatusCodes: this.options.failedRequestStatusCodes,
        failedRequestIgnoreUrls: this.options.failedRequestIgnoreUrls,
        talariaBaseUrl: this.options.baseUrl,
        onNetwork: (meta) => {
          if (
            (meta.failureKind === 'network' || meta.failureKind === 'timeout') &&
            !meta.aborted
          ) {
            this.rememberNetworkFailure(meta, { promoted: false });
          }
        },
        onFailedRequest: (meta) => {
          const status = meta.status;
          const method = meta.method || 'GET';
          const url = meta.url || '(unknown url)';
          const enriched = {
            ...meta,
            failureKind: 'http' as const,
            aborted: false,
          };
          const message = `HTTP ${status}: ${method} ${url}`;
          void this.capture({
            message,
            level: status >= 500 ? 'error' : 'warning',
            title: networkExceptionClass(enriched),
            exception: networkExceptionData(enriched, message),
            platform: PLATFORM_JAVASCRIPT,
            context: {
              tags: {
                ...networkFailureTags(enriched),
                'http.status_code': String(status),
              },
              extra: networkFailureExtra(enriched),
            },
          });
        },
        onNetworkError: (meta) => {
          this.rememberNetworkFailure(meta, { promoted: true });
          const method = meta.method || 'GET';
          const url = meta.url || '(unknown url)';
          const errLabel =
            meta.errorName && meta.errorMessage
              ? `${meta.errorName}: ${meta.errorMessage}`
              : meta.errorMessage || meta.errorName || 'Failed to fetch';
          const prefix =
            meta.failureKind === 'timeout' ? 'Timeout error' : 'Network error';
          const message = `${prefix}: ${method} ${url} — ${errLabel}`;
          void this.capture({
            message,
            level: 'error',
            title: networkExceptionClass(meta),
            exception: networkExceptionData(meta, message),
            platform: PLATFORM_JAVASCRIPT,
            context: {
              tags: networkFailureTags(meta),
              extra: networkFailureExtra(meta),
            },
          });
        },
      }),
      installVisibilityResumeHook(() => this.onForegroundResume()),
    );

    if (!this.options.disableDefaultIntegrations) {
      this.installGlobalHandlers();
    }

    this.flushTimer = setInterval(() => {
      void this.flush({ reason: 'interval' });
    }, SEGMENT_FLUSH_MS);

    if (typeof window !== 'undefined') {
      const onHide = () => {
        void this.flush({ reason: 'pagehide', keepalive: true, finish: true });
      };
      window.addEventListener('pagehide', onHide);
      window.addEventListener('beforeunload', onHide);
      this.teardowns.push(() => {
        window.removeEventListener('pagehide', onHide);
        window.removeEventListener('beforeunload', onHide);
      });
    }

    if (this.uploadEnabled) {
      this.markUploadStarted();
      void this.enqueueUpload(async () => {
        await this.ensureStarted({ keepalive: false });
      });
    }
  }

  getReplayId(): string | null {
    if (this.uploadEnabled && this.replayId) return this.replayId;
    return this.linkableReplayId;
  }

  async captureException(
    error: unknown,
    context?: CaptureContext,
  ): Promise<void> {
    if (this.capturing || this.ingestDisabled) return;

    const err =
      error instanceof Error
        ? error
        : new Error(typeof error === 'string' ? error : 'Unknown error');

    // Intentional cancellations — not actionable.
    if (isAbortError(err)) return;

    const filename = context?.source?.filename;
    if (
      isBrowserExtensionNoise({
        message: err.message,
        stack: err.stack,
        filename,
      }) ||
      isSdkInternalNoise({
        message: err.message,
        stack: err.stack,
      })
    ) {
      return;
    }

    // Correlate bare transport rejections with the wrapper's network breadcrumb.
    // Promoted failures and third-party (non-promoted) noise are suppressed.
    // First-party failures with promotion off keep the exception + merge context.
    const correlated = this.consumeCorrelatedNetworkFailure(err);
    if (correlated?.promoted) return;
    if (correlated && correlated.party === 'third_party') return;

    const mergedContext = correlated
      ? mergeNetworkFailureContext(context, correlated)
      : context;

    this.capturing = true;
    try {
      await this.capture({
        message: err.message || err.name || 'Error',
        level: 'error',
        title: err.name || 'Error',
        stackTrace: err.stack,
        exception: buildExceptionFromError(
          err,
          mergedContext,
          this.inAppFrameOptions(),
        ),
        platform: PLATFORM_JAVASCRIPT,
        context: mergedContext,
      });
    } finally {
      this.capturing = false;
    }
  }

  async captureMessage(
    message: string,
    level: SeverityLevel = 'info',
    context?: CaptureContext,
  ): Promise<void> {
    if (this.ingestDisabled) return;
    await this.capture({
      message,
      level,
      title: context?.title,
      context,
    });
  }

  /**
   * Returns a scoped capture facade that merges [tags] into every event.
   * Nested `withTags` calls merge further (later keys win).
   */
  withTags(tags: Record<string, string>): ScopedTalaria {
    return createScopedTalaria(this, mergeTags(tags));
  }

  async flush(opts?: {
    reason?: string;
    keepalive?: boolean;
    finish?: boolean;
  }): Promise<void> {
    if (!this.options || !this.transport || this.closed) return;

    const keepalive = opts?.keepalive ?? false;

    if (!this.uploadEnabled) {
      this.buffer.trimRing();
      return;
    }

    await this.enqueueUpload(async () => {
      // May have been disabled by an earlier queued task (error clip / limit).
      if (!this.uploadEnabled || this.closed) return;

      if (this.isPastErrorClipDeadline() && !opts?.finish) {
        // Already on the upload chain — call run* directly (no nested enqueue).
        await this.runEndErrorClip({ reason: 'error_clip_deadline' });
        return;
      }

      if (this.isPastMaxDuration() && !opts?.finish) {
        await this.runStopForMaxDuration({ keepalive });
        return;
      }

      await this.ensureStarted({ keepalive });
      await this.uploadPendingSegments({ keepalive });
      if (opts?.finish && this.uploadEnabled) {
        await this.finishOnServer({
          keepalive,
          reason: opts.reason ?? 'pagehide',
        });
        if (!this.sessionSampled) {
          this.resetToBufferMode();
        } else {
          this.uploadEnabled = false;
          this.clearMaxDurationTimer();
        }
      }
    });
  }

  /**
   * Stop recording, flush while still open, then fully reset so `init()` can
   * run again (React Strict Mode remount).
   */
  async close(): Promise<void> {
    if (this.closed && !this.options) return;

    this.clearErrorClipTimer();
    this.clearMaxDurationTimer();

    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    this.recorder?.stop();
    this.recorder = null;

    for (const teardown of this.teardowns.splice(0)) {
      try {
        teardown();
      } catch {
        // ignore
      }
    }

    // Flush BEFORE marking closed — otherwise flush() no-ops.
    if (this.uploadEnabled && this.options && this.transport) {
      try {
        await this.flush({ reason: 'close', finish: true });
      } catch (error) {
        console.warn('@newtalaria/browser: close flush failed', error);
      }
    }

    this.options = null;
    this.transport = null;
    this.replayId = null;
    this.sessionId = null;
    this.sessionSampled = false;
    this.uploadEnabled = false;
    this.startedOnServer = false;
    this.finishedOnServer = false;
    this.segmentIndex = 0;
    this.uploadedCompressedBytes = 0;
    this.uploadStartedAtMs = null;
    this.errorClipDeadlineMs = null;
    this.buffer.clear();
    this.uploadChain = Promise.resolve();
    this.closed = false;
    // Keep linkableReplayId across close only if a finish just happened mid-close;
    // Strict Mode remount should not inherit a stale link.
    this.linkableReplayId = null;
    this.lastReplayCaptureFailure = null;
    this.browserContext = null;
    this.capturing = false;
  }

  private onRrwebEvent(event: RrwebEvent): void {
    if (this.closed || !this.options) return;
    this.buffer.push(event);

    if (!this.uploadEnabled) {
      this.buffer.trimRing();
      return;
    }

    if (this.isPastErrorClipDeadline()) {
      void this.flush({ reason: 'error_clip_deadline' });
      return;
    }

    if (this.isPastMaxDuration()) {
      void this.flush({ reason: 'max_duration' });
      return;
    }

    if (this.buffer.shouldFlushBySize()) {
      void this.flush({ reason: 'size' });
    }
  }

  private async capture(args: {
    message: string;
    level: SeverityLevel;
    title?: string;
    stackTrace?: string;
    exception?: ExceptionData;
    platform?: string;
    context?: CaptureContext;
    keepalive?: boolean;
  }): Promise<void> {
    if (!this.options || !this.transport) {
      throw new Error('@newtalaria/browser: call Talaria.init() first');
    }
    if (this.ingestDisabled) return;

    // Stamp occurrence before replay flush/upload — that work can take seconds.
    // Server `createdAt` is ingest time; wire `timestamp` must stay occurrence time.
    const occurredAt = new Date();

    const isErrorLike = args.level === 'error' || args.level === 'fatal';
    let errorClipOutcome: ReplayCaptureOutcome | null = null;
    let attemptedErrorClip = false;

    if (isErrorLike && !this.sessionSampled) {
      if (!this.uploadEnabled) {
        if (Math.random() < this.options.replaysOnErrorSampleRate) {
          attemptedErrorClip = true;
          this.lastReplayCaptureFailure = null;
          this.uploadEnabled = true;
          // Prior clip drained the FullSnapshot; force a fresh paint base.
          this.checkoutFullSnapshot();
          this.markUploadStarted();
          this.scheduleErrorClipEnd();
        } else {
          errorClipOutcome = { status: 'skipped', reason: 'not_sampled' };
        }
      } else {
        // Re-arm timer to the same absolute deadline (does not extend the wall).
        attemptedErrorClip = true;
        this.scheduleErrorClipEnd();
      }
    }

    // Flush first so we only link a replayId when segments actually landed.
    if (this.uploadEnabled) {
      try {
        await this.flush({ reason: 'capture', keepalive: args.keepalive });
      } catch (error) {
        console.warn('@newtalaria/browser: replay flush failed', error);
        this.lastReplayCaptureFailure = {
          reason: 'upload_failed',
          details: {
            message: error instanceof Error ? error.message : String(error),
          },
        };
        if (!this.sessionSampled && this.segmentIndex === 0) {
          await this.abortUnusableClip('upload_failed', {
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    // Prefer the live upload id; if finish already reset to buffer mode (budget /
    // timer), use the id remembered at finish so the error still links.
    // Never link after a paint-base failure for this attempt.
    let replayId =
      this.uploadEnabled && this.segmentIndex > 0
        ? this.replayId
        : this.linkableReplayId;
    if (this.lastReplayCaptureFailure && this.segmentIndex === 0) {
      replayId = null;
    }

    if (isErrorLike && !this.sessionSampled) {
      if (replayId) {
        errorClipOutcome = { status: 'ok' };
        this.lastReplayCaptureFailure = null;
      } else if (errorClipOutcome?.status === 'skipped') {
        // keep not_sampled
      } else if (this.lastReplayCaptureFailure) {
        errorClipOutcome = {
          status: 'failed',
          reason: this.lastReplayCaptureFailure.reason,
          details: this.lastReplayCaptureFailure.details,
        };
      } else if (attemptedErrorClip) {
        errorClipOutcome = { status: 'failed', reason: 'buffer_empty' };
      }
    }

    const queuedMs = Math.max(0, Date.now() - occurredAt.getTime());

    const tags = applyReplayCaptureTags(
      mergeTags(
        this.browserContext ? browserContextTags(this.browserContext) : {},
        this.options.tags,
        args.context?.tags,
      ),
      errorClipOutcome,
    );
    warnSuspiciousTags(tags, this.options.environment);
    const scrubbedContextExtra = scrubLegacyExceptionExtra(
      args.context?.extra as Record<string, unknown> | undefined,
    );
    const extra = mergeReplayCaptureExtra(
      {
        ...(this.browserContext
          ? {
              browser: {
                name: this.browserContext.name,
                version: this.browserContext.version,
                os: this.browserContext.os,
                osVersion: this.browserContext.osVersion,
                device: this.browserContext.device,
                language: this.browserContext.language,
                userAgent: this.browserContext.userAgent,
                bot: this.browserContext.bot,
                ...(this.browserContext.botName
                  ? { botName: this.browserContext.botName }
                  : {}),
              },
            }
          : {}),
        sdk: {
          name: SDK_NAME,
          version: SDK_VERSION,
          // Time spent in capture() before ingest (mostly replay flush).
          ...(queuedMs >= 50 ? { queuedMs } : {}),
        },
        ...(scrubbedContextExtra ?? {}),
      },
      errorClipOutcome,
    );

    try {
      await ingestEvent(this.transport, {
        message: args.message,
        environment: this.options.environment,
        level: args.level,
        eventType: levelToEventType(args.level),
        title: args.title ?? args.context?.title,
        stackTrace: args.stackTrace,
        exception: args.exception,
        platform: args.platform,
        release: this.options.release,
        userId: args.context?.userId ?? this.options.userId,
        sessionId: this.sessionId ?? undefined,
        replayId: replayId ?? undefined,
        url: typeof location !== 'undefined' ? location.href : undefined,
        tags: Object.keys(tags).length ? tags : undefined,
        extraJson: extra ? JSON.stringify(extra) : undefined,
        timestamp: occurredAt.toISOString(),
        keepalive: args.keepalive,
      });
      // Consumed — don't attach the same clip to a later unrelated event.
      if (replayId && replayId === this.linkableReplayId) {
        this.linkableReplayId = null;
      }
    } catch (error) {
      // Do not rethrow — callers use `void captureException(...)` and a
      // rejected promise becomes unhandledrejection, which we would re-ingest
      // as a fake "Failed to fetch" app error (SDK stack only).
      console.warn('@newtalaria/browser: event ingest failed', error);
      if (isPermanentIngestError(error)) {
        this.disableIngestAfterPermanentError(error);
      }
    }
  }

  /**
   * Stop further event capture (and error-clip uploads) after a permanent
   * events/ingest 4xx so misconfig cannot spin forever.
   */
  private disableIngestAfterPermanentError(error: unknown): void {
    if (this.ingestDisabled) return;
    this.ingestDisabled = true;
    console.warn(
      '@newtalaria/browser: event ingest disabled after permanent client error',
      error,
    );
    // Error clips exist to accompany events — don't keep uploading them alone.
    if (!this.sessionSampled && this.uploadEnabled) {
      this.clearErrorClipTimer();
      void this.enqueueUpload(async () => {
        if (this.startedOnServer && !this.finishedOnServer) {
          await this.finishOnServer({
            keepalive: false,
            reason: 'ingest_disabled',
          });
        }
        this.resetToBufferMode();
      });
    } else if (!this.sessionSampled) {
      this.clearErrorClipTimer();
      this.uploadEnabled = false;
    }
  }

  private markUploadStarted(): void {
    if (this.uploadStartedAtMs == null) {
      this.uploadStartedAtMs = Date.now();
    }
    if (
      !this.sessionSampled &&
      this.options &&
      this.options.replaysErrorAfterMs > 0 &&
      this.errorClipDeadlineMs == null
    ) {
      this.errorClipDeadlineMs = computeErrorClipDeadlineMs(
        this.uploadStartedAtMs,
        this.options.replaysErrorAfterMs,
      );
    }
    this.scheduleMaxDurationStop();
  }

  private isPastMaxDuration(): boolean {
    if (this.uploadStartedAtMs == null) return false;
    return Date.now() - this.uploadStartedAtMs >= MAX_REPLAY_DURATION_MS;
  }

  private isPastErrorClipDeadline(): boolean {
    if (this.sessionSampled || this.errorClipDeadlineMs == null) return false;
    return Date.now() >= this.errorClipDeadlineMs;
  }

  private isErrorClipMode(): boolean {
    return (
      !this.sessionSampled &&
      !!this.options &&
      this.options.replaysErrorAfterMs > 0
    );
  }

  private scheduleMaxDurationStop(): void {
    if (this.closed || this.uploadStartedAtMs == null) return;
    this.clearMaxDurationTimer();
    const remaining = Math.max(
      0,
      MAX_REPLAY_DURATION_MS - (Date.now() - this.uploadStartedAtMs),
    );
    this.maxDurationTimer = setTimeout(() => {
      this.maxDurationTimer = null;
      if (!this.uploadEnabled || this.closed) return;
      void this.enqueueUpload(async () => {
        if (!this.uploadEnabled || this.closed) return;
        await this.runStopForMaxDuration({ keepalive: false });
      });
    }, remaining);
  }

  private clearMaxDurationTimer(): void {
    if (this.maxDurationTimer) {
      clearTimeout(this.maxDurationTimer);
      this.maxDurationTimer = null;
    }
  }

  private async runStopForMaxDuration(opts: {
    keepalive: boolean;
  }): Promise<void> {
    if (!this.uploadEnabled) return;
    await this.ensureStarted({ keepalive: opts.keepalive });
    await this.uploadPendingSegments({ keepalive: opts.keepalive });
    await this.finishOnServer({
      keepalive: opts.keepalive,
      reason: 'max_duration',
    });
    if (this.sessionSampled) {
      this.uploadEnabled = false;
      this.clearMaxDurationTimer();
      if (this.flushTimer) {
        clearInterval(this.flushTimer);
        this.flushTimer = null;
      }
    } else {
      this.resetToBufferMode();
    }
  }

  /**
   * Schedule end of the cheap error clip against a fixed absolute deadline.
   * Subsequent errors re-arm the timer but never push the wall later.
   */
  private scheduleErrorClipEnd(): void {
    if (this.sessionSampled || this.closed || !this.options) return;

    const afterMs = this.options.replaysErrorAfterMs;
    if (afterMs <= 0) return;

    if (this.errorClipDeadlineMs == null) {
      const started = this.uploadStartedAtMs ?? Date.now();
      this.errorClipDeadlineMs = computeErrorClipDeadlineMs(started, afterMs);
    }

    const remaining = Math.max(0, this.errorClipDeadlineMs - Date.now());
    this.clearErrorClipTimer();
    this.errorClipTimer = setTimeout(() => {
      this.errorClipTimer = null;
      void this.endErrorClip({ reason: 'error_clip' });
    }, remaining);
  }

  private clearErrorClipTimer(): void {
    if (this.errorClipTimer) {
      clearTimeout(this.errorClipTimer);
      this.errorClipTimer = null;
    }
  }

  /** Flush trailing post-error window, finish replay, return to ring buffer. */
  private async endErrorClip(opts?: { reason?: string }): Promise<void> {
    if (
      this.closed ||
      this.sessionSampled ||
      !this.uploadEnabled ||
      !this.options ||
      !this.transport
    ) {
      return;
    }

    await this.enqueueUpload(async () => {
      await this.runEndErrorClip(opts);
    });
  }

  private async runEndErrorClip(opts?: { reason?: string }): Promise<void> {
    if (!this.uploadEnabled || this.sessionSampled) return;
    await this.ensureStarted({ keepalive: false });
    await this.uploadPendingSegments({ keepalive: false });
    await this.finishOnServer({
      keepalive: false,
      reason: opts?.reason ?? 'error_clip',
    });
    this.resetToBufferMode();
  }

  /** After an error clip (or terminal limit), buffer locally until the next error. */
  private resetToBufferMode(): void {
    this.clearErrorClipTimer();
    this.clearMaxDurationTimer();
    this.uploadEnabled = false;
    this.startedOnServer = false;
    this.finishedOnServer = false;
    this.segmentIndex = 0;
    this.uploadedCompressedBytes = 0;
    this.uploadStartedAtMs = null;
    this.errorClipDeadlineMs = null;
    this.replayId = createId();
    // Drop orphan IncrementalSnapshots left after the FullSnapshot was uploaded —
    // otherwise the next clip starts mid-mutation and the player paints blank.
    this.buffer.clear();
    this.checkoutFullSnapshot();
  }

  /** Emit a checkout FullSnapshot into the ring buffer (sync via rrweb emit). */
  private checkoutFullSnapshot(): void {
    this.recorder?.takeFullSnapshot();
  }

  /**
   * Tab focus / bfcache restore: background timers are throttled, so the
   * buffer-mode checkout interval may not have fired. Refresh the paint base
   * so an error clip still has ~60s of usable lead-up after the user returns.
   */
  private onForegroundResume(): void {
    if (this.closed || !this.options || !this.recorder) return;

    if (!this.uploadEnabled) {
      this.buffer.trimRing();
    }
    this.checkoutFullSnapshot();
  }

  /**
   * Ensure segment 0 begins at Meta+FullSnapshot. Orphan increments alone
   * produce a blank rrweb player.
   * @returns false when no FullSnapshot is available.
   */
  private prepareBufferForNewReplay(): boolean {
    if (this.segmentIndex !== 0) return true;
    if (!this.buffer.hasFullSnapshot()) {
      this.checkoutFullSnapshot();
    }
    if (!this.buffer.trimToFullSnapshot()) {
      console.warn(
        '@newtalaria/browser: replay has no FullSnapshot; player may show a blank screen',
      );
      return false;
    }
    return true;
  }

  /**
   * Stop an error clip that cannot paint (missing/oversized FullSnapshot).
   * Does not set linkableReplayId — the error event should not open a blank player.
   */
  private async abortUnusableClip(
    reason: ReplayCaptureReason,
    details?: Record<string, unknown>,
  ): Promise<void> {
    this.lastReplayCaptureFailure = { reason, details };
    console.warn('@newtalaria/browser: aborting unusable replay clip', {
      reason,
      ...details,
    });
    this.buffer.clear();
    this.linkableReplayId = null;

    if (this.startedOnServer && !this.finishedOnServer && this.transport && this.replayId) {
      try {
        await finishReplay(this.transport, {
          replayId: this.replayId,
          reason: `capture_failed:${reason}`,
          keepalive: false,
        });
        this.finishedOnServer = true;
      } catch (error) {
        console.warn('@newtalaria/browser: replays/finish failed after abort', error);
      }
    }

    if (!this.sessionSampled) {
      this.resetToBufferMode();
    } else {
      this.uploadEnabled = false;
      this.clearErrorClipTimer();
      this.clearMaxDurationTimer();
    }
  }

  private stopUploadingAfterLimit(): void {
    this.clearErrorClipTimer();
    this.clearMaxDurationTimer();
    this.uploadEnabled = false;
    if (this.sessionSampled) {
      if (this.flushTimer) {
        clearInterval(this.flushTimer);
        this.flushTimer = null;
      }
    } else {
      this.resetToBufferMode();
    }
  }

  private inAppFrameOptions(): InAppFrameOptions {
    const opts = this.options;
    let pageOrigin: string | undefined;
    try {
      pageOrigin = resolvePageOrigin(
        typeof window !== 'undefined' ? window.location?.origin : undefined,
      );
    } catch {
      pageOrigin = undefined;
    }
    return {
      pageOrigin,
      allowUrls: opts?.inAppAllowUrls,
      denyUrls: opts?.inAppDenyUrls,
      inAppOrigins: opts?.inAppOrigins,
    };
  }

  private pruneRecentNetworkFailures(now = Date.now()): void {
    this.recentNetworkFailures = this.recentNetworkFailures.filter(
      (f) => now - f.at <= RECENT_NETWORK_FAILURE_MS,
    );
  }

  private rememberNetworkFailure(
    meta: NetworkMeta,
    opts: { promoted: boolean },
  ): void {
    // Never correlate against Talaria ingest/replay traffic.
    if (this.options) {
      const ignore = buildFailedRequestIgnoreUrls(
        this.options.failedRequestIgnoreUrls,
        this.options.baseUrl,
      );
      if (urlMatchesIgnoreList(meta.url || '', ignore)) return;
    }

    const now = Date.now();
    this.pruneRecentNetworkFailures(now);

    for (let i = this.recentNetworkFailures.length - 1; i >= 0; i--) {
      const existing = this.recentNetworkFailures[i]!;
      if (
        existing.method === meta.method &&
        existing.url === meta.url &&
        existing.errorMessage === meta.errorMessage &&
        now - existing.at < 1_000
      ) {
        existing.promoted = existing.promoted || opts.promoted;
        existing.durationMs = meta.durationMs ?? existing.durationMs;
        existing.errorName = meta.errorName ?? existing.errorName;
        existing.aborted = meta.aborted ?? existing.aborted;
        existing.failureKind = meta.failureKind ?? existing.failureKind;
        existing.party = meta.party ?? existing.party;
        existing.origin = meta.origin ?? existing.origin;
        return;
      }
    }

    this.recentNetworkFailures.push({
      ...meta,
      at: now,
      promoted: opts.promoted,
    });
  }

  /**
   * Find a recent transport failure for a bare fetch TypeError / TimeoutError.
   * Consumes the entry so a later duplicate path cannot reuse it.
   */
  private consumeCorrelatedNetworkFailure(
    error: Error,
  ): RecentNetworkFailure | null {
    if (!isCorrelatableTransportError(error)) return null;

    const wantKind = isTimeoutError(error) ? 'timeout' : 'network';
    const now = Date.now();
    this.pruneRecentNetworkFailures(now);

    const takeAt = (index: number): RecentNetworkFailure => {
      const [failure] = this.recentNetworkFailures.splice(index, 1);
      return failure!;
    };

    // Prefer the failure whose message matches this rejection.
    for (let i = this.recentNetworkFailures.length - 1; i >= 0; i--) {
      const failure = this.recentNetworkFailures[i]!;
      if (failure.aborted || failure.failureKind !== wantKind) continue;
      if (failure.errorMessage && failure.errorMessage === error.message) {
        return takeAt(i);
      }
    }

    // Fallback: most recent matching transport failure in the window.
    for (let i = this.recentNetworkFailures.length - 1; i >= 0; i--) {
      const failure = this.recentNetworkFailures[i]!;
      if (failure.aborted || failure.failureKind !== wantKind) continue;
      return takeAt(i);
    }
    return null;
  }

  private installGlobalHandlers(): void {
    if (typeof window === 'undefined') return;

    const onError = (event: ErrorEvent) => {
      // Browsers redact cross-origin throws to "Script error." — not actionable.
      if (isOpaqueCrossOriginScriptError(event)) return;

      const error =
        event.error instanceof Error
          ? event.error
          : new Error(event.message || 'window.onerror');

      if (
        isBrowserExtensionNoise({
          message: event.message || error.message,
          stack: error.stack,
          filename: event.filename,
        })
      ) {
        return;
      }

      void this.captureException(error, {
        mechanism: { type: 'onerror', handled: false },
        source: {
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
        },
      });
    };

    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      if (isAbortError(reason)) return;
      const err =
        reason instanceof Error
          ? reason
          : new Error(
              typeof reason === 'string' ? reason : 'unhandledrejection',
            );
      if (
        isBrowserExtensionNoise({
          message: err.message,
          stack: err.stack,
        }) ||
        isSdkInternalNoise({
          message: err.message,
          stack: err.stack,
        })
      ) {
        return;
      }
      void this.captureException(reason, {
        mechanism: { type: 'unhandledrejection', handled: false },
      });
    };

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    this.teardowns.push(() => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    });
  }

  private enqueueUpload(task: () => Promise<void>): Promise<void> {
    this.uploadChain = this.uploadChain.then(task, task);
    return this.uploadChain;
  }

  private async ensureStarted(opts: { keepalive: boolean }): Promise<void> {
    if (!this.options || !this.transport || !this.replayId || !this.sessionId) {
      return;
    }
    if (this.startedOnServer || this.finishedOnServer) return;

    await startReplay(this.transport, {
      replayId: this.replayId,
      environment: this.options.environment,
      sessionId: this.sessionId,
      url: typeof location !== 'undefined' ? location.href : undefined,
      userId: this.options.userId,
      keepalive: opts.keepalive,
    });
    this.startedOnServer = true;
    this.markUploadStarted();
  }

  private async uploadPendingSegments(opts: {
    keepalive: boolean;
  }): Promise<void> {
    if (!this.options || !this.transport || !this.replayId) return;
    if (!this.startedOnServer || this.finishedOnServer) return;

    if (!this.prepareBufferForNewReplay()) {
      const leftover = this.buffer.peekFullSnapshot();
      await this.abortUnusableClip(
        'no_full_snapshot',
        paintBaseSizeDetails(leftover ? [leftover] : []),
      );
      return;
    }

    while (this.buffer.length > 0) {
      if (this.isPastMaxDuration()) {
        break;
      }

      if (this.isPastErrorClipDeadline()) {
        break;
      }

      if (this.segmentIndex >= this.maxSegmentsAllowed()) {
        console.warn(
          '@newtalaria/browser: replay upload stopped (max segments)',
          { segmentIndex: this.segmentIndex },
        );
        await this.finishOnServer({
          keepalive: opts.keepalive,
          reason: 'max_segments',
        });
        this.stopUploadingAfterLimit();
        break;
      }

      if (
        this.isErrorClipMode() &&
        isErrorClipBudgetExhausted({
          segmentIndex: this.segmentIndex,
          uploadedCompressedBytes: this.uploadedCompressedBytes,
        })
      ) {
        console.warn(
          '@newtalaria/browser: replay upload stopped (error clip budget)',
          {
            segmentIndex: this.segmentIndex,
            uploadedCompressedBytes: this.uploadedCompressedBytes,
          },
        );
        await this.finishOnServer({
          keepalive: opts.keepalive,
          reason: 'error_clip_budget',
        });
        this.stopUploadingAfterLimit();
        break;
      }

      const fitted = await this.takeFittedSegment();
      if (!fitted) break;

      if (fitted.abortReason) {
        await this.abortUnusableClip(fitted.abortReason, fitted.abortDetails);
        return;
      }

      const { events, gzip } = fitted;

      if (
        this.segmentIndex === 0 &&
        !events.some((e) => e.type === RRWEB_FULL_SNAPSHOT)
      ) {
        // Should be unreachable after paint-base-aware take/fit — treat as
        // missing paint base rather than uploading Meta-only.
        await this.abortUnusableClip(
          'no_full_snapshot',
          paintBaseSizeDetails(events),
        );
        return;
      }

      if (
        this.isErrorClipMode() &&
        this.uploadedCompressedBytes + gzip.length >
          MAX_ERROR_CLIP_COMPRESSED_BYTES &&
        this.segmentIndex > 0
      ) {
        // Keep already-uploaded playable segments; drop the rest of the buffer.
        this.buffer.clear();
        await this.finishOnServer({
          keepalive: opts.keepalive,
          reason: 'error_clip_budget',
        });
        this.stopUploadingAfterLimit();
        break;
      }

      const startedAt = new Date(events[0]!.timestamp);
      const endedAt = new Date(events[events.length - 1]!.timestamp);
      const index = this.segmentIndex;

      try {
        await ingestReplaySegment(this.transport, {
          replayId: this.replayId,
          segmentIndex: index,
          events,
          startedAt,
          endedAt,
          gzip,
          keepalive: opts.keepalive,
        });
        this.segmentIndex = index + 1;
        this.uploadedCompressedBytes += gzip.length;
        if (index === 0) {
          this.lastReplayCaptureFailure = null;
        }
      } catch (error) {
        if (isTerminalReplayLimitError(error)) {
          console.warn(
            '@newtalaria/browser: replay upload stopped (server limit)',
            error,
          );
          await this.finishOnServer({
            keepalive: opts.keepalive,
            reason: 'limit',
          });
          this.stopUploadingAfterLimit();
          break;
        }

        if (isOversizedSegmentError(error)) {
          // Never bisect a segment-0 paint base into Meta-only + orphan FS.
          if (
            this.segmentIndex === 0 &&
            paintBaseEventCount(events) > 0
          ) {
            await this.abortUnusableClip('oversized_full_snapshot', {
              source: 'server_reject_paint_base',
              ...paintBaseSizeDetails(events),
              rejectedCompressedBytes: gzip.length,
            });
            return;
          }

          const plan = planOversizedRetry(events);
          if (plan.action === 'drop') {
            const droppedType = events[0]?.type;
            console.warn(
              '@newtalaria/browser: dropping rrweb event rejected as oversized',
              { type: droppedType },
            );
            if (droppedType === RRWEB_FULL_SNAPSHOT) {
              await this.abortUnusableClip(
                'oversized_full_snapshot',
                {
                  source: 'server_reject',
                  ...paintBaseSizeDetails(events),
                  rejectedCompressedBytes: gzip.length,
                },
              );
              return;
            }
            continue;
          }
          this.buffer.prepend(plan.right);
          this.buffer.prepend(plan.left);
          continue;
        }

        this.buffer.prepend(events);
        console.warn('@newtalaria/browser: replays/ingestSegment failed', error);
        if (this.segmentIndex === 0) {
          await this.abortUnusableClip('upload_failed', {
            message: error instanceof Error ? error.message : String(error),
          });
        }
        break;
      }

      if (opts.keepalive) break;
    }
  }

  private maxSegmentsAllowed(): number {
    if (this.sessionSampled) return MAX_SEGMENTS_PER_REPLAY;
    if (this.options && this.options.replaysErrorAfterMs <= 0) {
      return MAX_SEGMENTS_PER_REPLAY;
    }
    return MAX_SEGMENTS_ERROR_CLIP;
  }

  /**
   * Pull the largest event prefix that gzips under the target compressed size.
   *
   * Segment 0 keeps Meta+FullSnapshot (paint base) atomic through take + fit so
   * a soft estimated-byte window cannot orphan the FullSnapshot.
   */
  private async takeFittedSegment(): Promise<{
    events: RrwebEvent[];
    gzip: Uint8Array;
    abortReason?: ReplayCaptureReason;
    abortDetails?: Record<string, unknown>;
  } | null> {
    const isPaintBaseSegment = this.segmentIndex === 0;
    const chunk = this.buffer.takeByEstimatedBytes(SEGMENT_SIZE_BYTES, {
      keepPaintBaseTogether: isPaintBaseSegment,
    });
    if (chunk.length === 0) return null;

    const atomicMin = isPaintBaseSegment ? paintBaseEventCount(chunk) : 0;
    const fitted = await fitCompressedPrefix(
      chunk,
      compressReplayEvents,
      TARGET_COMPRESSED_SEGMENT_BYTES,
      MAX_COMPRESSED_SEGMENT_BYTES,
      atomicMin > 0 ? { atomicMinCount: atomicMin } : undefined,
    );

    if (!fitted) {
      if (isPaintBaseSegment && atomicMin > 0) {
        const paint = chunk.slice(0, atomicMin);
        let compressedBytes: number | undefined;
        const full = paint.find((e) => e.type === RRWEB_FULL_SNAPSHOT);
        if (full) {
          try {
            compressedBytes = (await compressReplayEvents([full])).length;
          } catch {
            // ignore
          }
        }
        // Put non-paint remainder back; paint base itself cannot ship.
        if (chunk.length > atomicMin) {
          this.buffer.prepend(chunk.slice(atomicMin));
        }
        return {
          events: [],
          gzip: new Uint8Array(),
          abortReason: 'oversized_full_snapshot',
          abortDetails: {
            source: 'paint_base_exceeds_hard_cap',
            ...paintBaseSizeDetails(paint, {
              fullSnapshotCompressedBytes: compressedBytes,
            }),
          },
        };
      }

      const dropped = chunk[0];
      console.warn(
        '@newtalaria/browser: dropping rrweb event that exceeds max segment size',
        { type: dropped?.type },
      );
      if (chunk.length > 1) {
        this.buffer.prepend(chunk.slice(1));
      }
      return this.takeFittedSegment();
    }

    if (fitted.remainder.length > 0) {
      this.buffer.prepend(fitted.remainder);
    }
    return { events: fitted.events, gzip: fitted.gzip };
  }
  private async finishOnServer(opts: {
    keepalive: boolean;
    reason: string;
  }): Promise<void> {
    if (!this.transport || !this.replayId) return;
    if (!this.startedOnServer || this.finishedOnServer) return;

    // Remember before finish/reset so captureException can still link the event.
    if (this.segmentIndex > 0) {
      this.linkableReplayId = this.replayId;
    }

    try {
      await finishReplay(this.transport, {
        replayId: this.replayId,
        reason: opts.reason,
        keepalive: opts.keepalive,
      });
      this.finishedOnServer = true;
    } catch (error) {
      console.warn('@newtalaria/browser: replays/finish failed', error);
    }
  }
}

/** Capture surface that inherits tags from `withTags`. */
export interface ScopedTalaria {
  captureException(error: unknown, context?: CaptureContext): Promise<void>;
  captureMessage(
    message: string,
    level?: SeverityLevel,
    context?: CaptureContext,
  ): Promise<void>;
  withTags(tags: Record<string, string>): ScopedTalaria;
}

function createScopedTalaria(
  client: TalariaClient,
  scopeTags: TagMap,
): ScopedTalaria {
  const mergeContext = (context?: CaptureContext): CaptureContext => ({
    ...context,
    tags: mergeTags(scopeTags, context?.tags),
  });

  return {
    captureException(error, context) {
      return client.captureException(error, mergeContext(context));
    },
    captureMessage(message, level, context) {
      return client.captureMessage(message, level, mergeContext(context));
    },
    withTags(tags) {
      return createScopedTalaria(client, mergeTags(scopeTags, tags));
    },
  };
}
