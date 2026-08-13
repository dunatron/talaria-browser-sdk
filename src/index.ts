import { TalariaClient } from './client.js';
import type {
  CaptureContext,
  LoggerOptions,
  SeverityLevel,
  TalariaInitOptions,
} from './types.js';

const client = new TalariaClient();

/**
 * Talaria browser SDK — error capture, logging, session replay, and tracing.
 *
 * ```ts
 * import { Talaria } from '@newtalaria/browser';
 *
 * Talaria.init({
 *   dsn: 'https://api.newtalaria.com',
 *   apiKey: 'tal_live_…',
 *   environment: 'production',
 *   minLevel: 'warning',
 *   replaysOnErrorSampleRate: 1,
 *   replaysErrorAfterMs: 15_000,
 * });
 *
 * const logger = Talaria.logger({ tags: { feature: 'checkout' } });
 * await logger.warn('Payment method missing');
 * await logger.captureException(err);
 * ```
 */
export const Talaria = {
  init(options: TalariaInitOptions): void {
    client.init(options);
  },

  captureException(error: unknown, context?: CaptureContext): Promise<void> {
    return client.captureException(error, context);
  },

  captureMessage(
    message: string,
    level?: SeverityLevel,
    context?: CaptureContext,
  ): Promise<void> {
    return client.captureMessage(message, level, context);
  },

  debug(message: string, context?: CaptureContext): Promise<void> {
    return client.debug(message, context);
  },

  info(message: string, context?: CaptureContext): Promise<void> {
    return client.info(message, context);
  },

  warning(message: string, context?: CaptureContext): Promise<void> {
    return client.warning(message, context);
  },

  warn(message: string, context?: CaptureContext): Promise<void> {
    return client.warn(message, context);
  },

  error(message: string, context?: CaptureContext): Promise<void> {
    return client.error(message, context);
  },

  fatal(message: string, context?: CaptureContext): Promise<void> {
    return client.fatal(message, context);
  },

  log(
    level: SeverityLevel,
    message: string,
    context?: CaptureContext,
  ): Promise<void> {
    return client.log(level, message, context);
  },

  logger(options?: string | LoggerOptions) {
    return client.logger(options);
  },

  withTags(tags: Record<string, string>) {
    return client.withTags(tags);
  },

  getMinLevel(): SeverityLevel {
    return client.getMinLevel();
  },

  setMinLevel(level: SeverityLevel): void {
    client.setMinLevel(level);
  },

  isEnforceDefaultLevel(): boolean {
    return client.isEnforceDefaultLevel();
  },

  setEnforceDefaultLevel(enforce: boolean): void {
    client.setEnforceDefaultLevel(enforce);
  },

  isLevelEnabled(level: SeverityLevel): boolean {
    return client.isLevelEnabled(level);
  },

  getReplayId(): string | null {
    return client.getReplayId();
  },

  getTraceId(): string | null {
    return client.getTraceId();
  },

  getSpanId(): string | null {
    return client.getSpanId();
  },

  flush(): Promise<void> {
    return client.flush();
  },

  close(): Promise<void> {
    return client.close();
  },
};

export { TalariaClient } from './client.js';
export type { ScopedTalaria, TalariaLogger } from './client.js';
export {
  mergeTags,
  normalizeTags,
  RESERVED_TAG_KEYS,
} from './utils/tags.js';
export {
  SEVERITY_ORDER,
  maxSeverity,
  normalizeSeverity,
  severityAtLeast,
} from './utils/severity.js';
export {
  computeErrorClipDeadlineMs,
  fitCompressedPrefix,
  isErrorClipBudgetExhausted,
  planOversizedRetry,
} from './replay/fit_segment.js';
export {
  MAX_SEGMENTS_ERROR_CLIP,
  MAX_ERROR_CLIP_COMPRESSED_BYTES,
  TARGET_COMPRESSED_SEGMENT_BYTES,
  MAX_COMPRESSED_SEGMENT_BYTES,
} from './replay/segment_buffer.js';

export type {
  BeforeSendEvent,
  BeforeSendHint,
  Breadcrumb,
  CaptureContext,
  DebugImage,
  DebugMeta,
  Environment,
  ExceptionData,
  ExceptionMechanism,
  ExceptionValue,
  FailedRequestStatusCode,
  LoggerOptions,
  LoggerPreset,
  SeverityLevel,
  StackFrame,
  StackTrace,
  TalariaInitOptions,
} from './types.js';
export {
  applySourceLocation,
  isInAppFrame,
  parseStackLine,
  parseStackTrace,
  resolvePageOrigin,
} from './utils/stacktrace.js';
export type { InAppFrameOptions } from './utils/stacktrace.js';
export {
  REPLAY_CAPTURE_TAG,
  REPLAY_CAPTURE_REASON_TAG,
} from './replay/capture_outcome.js';
export type {
  ReplayCaptureOutcome,
  ReplayCaptureReason,
  ReplayCaptureStatus,
} from './replay/capture_outcome.js';

export {
  parseTraceparent,
  formatTraceparent,
} from './tracing/traceparent.js';
export {
  isTracingEnabled,
  resolveTracesSampleRate,
  DEFAULT_TRACES_SAMPLE_RATE,
} from './tracing/sampling.js';
export { MAX_BREADCRUMBS } from './tracing/breadcrumbs.js';
export { shouldInjectTraceparent } from './tracing/instrument_http.js';
export { ingestSpanBatch } from './transport/spans.js';
export type { IngestSpanParams, SpanKind, SpanStatus } from './transport/spans.js';

export default Talaria;
