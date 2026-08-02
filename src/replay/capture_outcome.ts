/** Durable tags on error events when an error-clip replay was attempted. */
export const REPLAY_CAPTURE_TAG = 'replay.capture';
export const REPLAY_CAPTURE_REASON_TAG = 'replay.capture_reason';

export type ReplayCaptureStatus = 'ok' | 'failed' | 'skipped';

export type ReplayCaptureReason =
  | 'oversized_full_snapshot'
  | 'no_full_snapshot'
  | 'upload_failed'
  | 'not_sampled'
  | 'buffer_empty';

export interface ReplayCaptureFailure {
  reason: ReplayCaptureReason;
  details?: Record<string, unknown>;
}

export interface ReplayCaptureOutcome {
  status: ReplayCaptureStatus;
  reason?: ReplayCaptureReason;
  details?: Record<string, unknown>;
}

/** Merge replay capture tags into event tags (error-clip path only). */
export function applyReplayCaptureTags(
  tags: Record<string, string>,
  outcome: ReplayCaptureOutcome | null,
): Record<string, string> {
  if (!outcome) return tags;
  const next = { ...tags };
  next[REPLAY_CAPTURE_TAG] = outcome.status;
  if (outcome.reason) {
    next[REPLAY_CAPTURE_REASON_TAG] = outcome.reason;
  }
  return next;
}

export function mergeReplayCaptureExtra(
  extra: Record<string, unknown> | undefined,
  outcome: ReplayCaptureOutcome | null,
): Record<string, unknown> | undefined {
  if (!outcome || outcome.status === 'ok') {
    return extra;
  }
  return {
    ...(extra ?? {}),
    replayCapture: {
      attempted: outcome.status === 'failed',
      status: outcome.status,
      reason: outcome.reason,
      ...(outcome.details ?? {}),
    },
  };
}
