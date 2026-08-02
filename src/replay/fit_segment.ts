import {
  ERROR_CLIP_FLUSH_SLACK_MS,
  MAX_COMPRESSED_SEGMENT_BYTES,
  MAX_ERROR_CLIP_COMPRESSED_BYTES,
  MAX_SEGMENTS_ERROR_CLIP,
  RRWEB_FULL_SNAPSHOT,
  RRWEB_META,
  TARGET_COMPRESSED_SEGMENT_BYTES,
  type RrwebEvent,
} from './segment_buffer.js';

export type CompressEvents = (events: RrwebEvent[]) => Promise<Uint8Array>;

/**
 * Absolute error-clip wall: upload start + afterMs + flush slack.
 * Callers must set this once; later errors must not recompute a later wall.
 */
export function computeErrorClipDeadlineMs(
  uploadStartedAtMs: number,
  afterMs: number,
  slackMs = ERROR_CLIP_FLUSH_SLACK_MS,
): number {
  return uploadStartedAtMs + afterMs + slackMs;
}

/** True when error-clip segment or compressed-byte budget is exhausted. */
export function isErrorClipBudgetExhausted(opts: {
  segmentIndex: number;
  uploadedCompressedBytes: number;
  maxSegments?: number;
  maxBytes?: number;
}): boolean {
  const maxSegments = opts.maxSegments ?? MAX_SEGMENTS_ERROR_CLIP;
  const maxBytes = opts.maxBytes ?? MAX_ERROR_CLIP_COMPRESSED_BYTES;
  return (
    opts.segmentIndex >= maxSegments ||
    opts.uploadedCompressedBytes >= maxBytes
  );
}

/**
 * How to handle a segment rejected as oversized.
 * Never re-queue an identical single-event payload (that loops forever).
 */
export function planOversizedRetry(
  events: RrwebEvent[],
): { action: 'drop' } | { action: 'bisect'; left: RrwebEvent[]; right: RrwebEvent[] } {
  if (events.length <= 1) {
    return { action: 'drop' };
  }
  const mid = Math.ceil(events.length / 2);
  return {
    action: 'bisect',
    left: events.slice(0, mid),
    right: events.slice(mid),
  };
}

/** Leading Meta+FullSnapshot (2) or FullSnapshot alone (1); else 0. */
export function paintBaseEventCount(events: RrwebEvent[]): number {
  if (events.length === 0) return 0;
  if (
    events[0]!.type === RRWEB_META &&
    events[1]?.type === RRWEB_FULL_SNAPSHOT
  ) {
    return 2;
  }
  if (events[0]!.type === RRWEB_FULL_SNAPSHOT) {
    return 1;
  }
  return 0;
}

/**
 * Binary-search the largest prefix that gzips under the pack target.
 * Remainder is returned for re-queue; null means every event was dropped.
 *
 * When `atomicMinCount` is set (segment-0 paint base), never return a prefix
 * shorter than that count unless the atomic unit itself exceeds `hardCap`
 * (then null — caller should abort as oversized, not ship Meta-only).
 */
export async function fitCompressedPrefix(
  events: RrwebEvent[],
  compress: CompressEvents,
  targetBytes = TARGET_COMPRESSED_SEGMENT_BYTES,
  hardCap = MAX_COMPRESSED_SEGMENT_BYTES,
  opts?: { atomicMinCount?: number },
): Promise<{
  events: RrwebEvent[];
  gzip: Uint8Array;
  remainder: RrwebEvent[];
} | null> {
  if (events.length === 0) return null;

  const atomicMin = opts?.atomicMinCount ?? 0;
  if (atomicMin > 0) {
    if (events.length < atomicMin) return null;
    const paint = events.slice(0, atomicMin);
    const paintGzip = await compress(paint);
    if (paintGzip.length > hardCap) {
      // Atomic paint base cannot ship — do not fall back to Meta-only.
      return null;
    }

    // Grow beyond the paint base under the soft target (still ≤ hardCap).
    let lo = atomicMin;
    let hi = events.length;
    let best: { events: RrwebEvent[]; gzip: Uint8Array } = {
      events: paint,
      gzip: paintGzip,
    };

    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (mid < atomicMin) {
        lo = atomicMin;
        continue;
      }
      const prefix = events.slice(0, mid);
      const gzip = await compress(prefix);
      if (gzip.length <= targetBytes && gzip.length <= hardCap) {
        best = { events: prefix, gzip };
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    return {
      events: best.events,
      gzip: best.gzip,
      remainder: events.slice(best.events.length),
    };
  }

  let remaining = events;
  while (remaining.length > 0) {
    let lo = 1;
    let hi = remaining.length;
    let best: { events: RrwebEvent[]; gzip: Uint8Array } | null = null;

    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      const prefix = remaining.slice(0, mid);
      const gzip = await compress(prefix);
      if (gzip.length <= targetBytes && gzip.length <= hardCap) {
        best = { events: prefix, gzip };
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    if (best) {
      return {
        events: best.events,
        gzip: best.gzip,
        remainder: remaining.slice(best.events.length),
      };
    }

    // Single event cannot fit — drop and continue.
    remaining = remaining.slice(1);
  }

  return null;
}
