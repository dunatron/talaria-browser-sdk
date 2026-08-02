import { TalariaClient } from './client.js';
import type {
  CaptureContext,
  SeverityLevel,
  TalariaInitOptions,
} from './types.js';

const client = new TalariaClient();

/**
 * Talaria browser SDK — error capture + session replay.
 *
 * ```ts
 * import { Talaria } from '@newtalaria/browser';
 *
 * Talaria.init({
 *   dsn: 'http://localhost:8080',
 *   apiKey: 'tal_live_…',
 *   environment: 'development',
 *   replaysOnErrorSampleRate: 1,
 *   // Default 15s post-error clip; set 0 to continue until 5 min cap.
 *   replaysErrorAfterMs: 15_000,
 * });
 *
 * try {
 *   throw new Error('boom');
 * } catch (e) {
 *   await Talaria.captureException(e);
 * }
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

  withTags(tags: Record<string, string>) {
    return client.withTags(tags);
  },

  getReplayId(): string | null {
    return client.getReplayId();
  },

  flush(): Promise<void> {
    return client.flush();
  },

  close(): Promise<void> {
    return client.close();
  },
};

export { TalariaClient } from './client.js';
export type { ScopedTalaria } from './client.js';
export {
  mergeTags,
  normalizeTags,
  RESERVED_TAG_KEYS,
} from './utils/tags.js';
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
  CaptureContext,
  DebugImage,
  DebugMeta,
  Environment,
  ExceptionData,
  ExceptionMechanism,
  ExceptionValue,
  FailedRequestStatusCode,
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

export default Talaria;
