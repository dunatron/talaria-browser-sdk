import { estimateJsonBytes } from '../utils/estimate.js';

/** Minimal rrweb event shape used by the buffer. */
export interface RrwebEvent {
  type: number;
  data: unknown;
  timestamp: number;
}

/**
 * Soft estimated-JSON take size before gzip fitting.
 * Not a hard server limit — packing uses MAX_COMPRESSED_SEGMENT_BYTES.
 * Paint base (Meta+FullSnapshot) is taken atomically and may exceed this.
 */
export const SEGMENT_SIZE_BYTES = 800_000;
/**
 * Server hard cap — keep in sync with ReplayLimits.maxCompressedSegmentBytes.
 * Restart Serverpod after changing this constant pair.
 */
export const MAX_COMPRESSED_SEGMENT_BYTES = 1024 * 1024;
/** Pack under hard cap minus margin (never disagree with a live 1MiB server). */
export const TARGET_COMPRESSED_SEGMENT_BYTES =
  MAX_COMPRESSED_SEGMENT_BYTES - 64 * 1024;
/**
 * Absolute max segments per replay (session / long error mode).
 * Keep in sync with ReplayLimits.maxSegmentsPerReplay.
 */
export const MAX_SEGMENTS_PER_REPLAY = 200;
/**
 * Error-clip mode: hard segment budget so one heavy page cannot spam ingest.
 */
export const MAX_SEGMENTS_ERROR_CLIP = 12;
/** Error-clip mode: hard compressed-byte budget for the whole clip. */
export const MAX_ERROR_CLIP_COMPRESSED_BYTES = 2 * 1024 * 1024;
/** Slack added to the error-clip wall for in-flight flush. */
export const ERROR_CLIP_FLUSH_SLACK_MS = 5_000;
/** Periodic flush interval. */
export const SEGMENT_FLUSH_MS = 5_000;
/** Keep ~60s of events while buffering (error-only sample path). */
export const RING_BUFFER_MS = 60_000;
/**
 * rrweb checkout interval in buffer mode — must be ≤ {@link RING_BUFFER_MS}
 * so a FullSnapshot always remains inside the ring after idle/away trim.
 */
export const RING_BUFFER_CHECKOUT_MS = RING_BUFFER_MS;
/** Cap ring buffer size so one error flush stays bounded. */
export const RING_BUFFER_MAX_BYTES = 1_500_000;
/** Default post-error upload window (cheap error clip). */
export const ERROR_REPLAY_AFTER_MS = 15_000;
/**
 * Hard cap for continuous upload (session sample or error-continue mode).
 * Keep in sync with ReplayLimits.defaultMaxDurationMs on the server.
 */
export const MAX_REPLAY_DURATION_MS = 5 * 60 * 1000;

/** rrweb EventType.FullSnapshot */
export const RRWEB_FULL_SNAPSHOT = 2;
/** rrweb EventType.Meta */
export const RRWEB_META = 4;

export class SegmentBuffer {
  private events: RrwebEvent[] = [];
  private pendingBytes = 0;

  get length(): number {
    return this.events.length;
  }

  get estimatedBytes(): number {
    return this.pendingBytes;
  }

  push(event: RrwebEvent): void {
    this.events.push(event);
    this.pendingBytes += estimateJsonBytes(event);
  }

  hasFullSnapshot(): boolean {
    return this.events.some((e) => e.type === RRWEB_FULL_SNAPSHOT);
  }

  /** First FullSnapshot still queued (does not remove it). */
  peekFullSnapshot(): RrwebEvent | undefined {
    return this.events.find((e) => e.type === RRWEB_FULL_SNAPSHOT);
  }

  /**
   * Drop leading events until Meta+FullSnapshot (or FullSnapshot alone).
   * Returns false if no FullSnapshot is present (replay would paint blank).
   */
  trimToFullSnapshot(): boolean {
    const fullIdx = this.events.findIndex((e) => e.type === RRWEB_FULL_SNAPSHOT);
    if (fullIdx < 0) return false;
    let start = fullIdx;
    if (fullIdx > 0 && this.events[fullIdx - 1]!.type === RRWEB_META) {
      start = fullIdx - 1;
    }
    if (start > 0) {
      this.events.splice(0, start);
      this.recomputeBytes();
    }
    return true;
  }

  /**
   * Drop events older than the ring window and/or over the byte cap
   * (buffer-only mode). Prefer keeping the newest events.
   */
  trimRing(now = Date.now(), maxBytes = RING_BUFFER_MAX_BYTES): void {
    const cutoff = now - RING_BUFFER_MS;
    let remove = 0;
    while (remove < this.events.length && this.events[remove]!.timestamp < cutoff) {
      remove++;
    }
    if (remove > 0) {
      this.events.splice(0, remove);
      this.recomputeBytes();
    }

    while (this.events.length > 1 && this.pendingBytes > maxBytes) {
      this.events.shift();
      this.recomputeBytes();
    }
  }

  shouldFlushBySize(): boolean {
    return this.pendingBytes >= SEGMENT_SIZE_BYTES;
  }

  /**
   * How many leading events form the rrweb paint base (Meta+FullSnapshot or
   * FullSnapshot alone). Returns 0 if the buffer does not start with a paint base.
   */
  paintBaseLength(): number {
    if (this.events.length === 0) return 0;
    if (
      this.events[0]!.type === RRWEB_META &&
      this.events[1]?.type === RRWEB_FULL_SNAPSHOT
    ) {
      return 2;
    }
    if (this.events[0]!.type === RRWEB_FULL_SNAPSHOT) {
      return 1;
    }
    return 0;
  }

  /**
   * Take a prefix of events whose estimated JSON size is ~maxBytes.
   * Always returns at least one event when the buffer is non-empty (caller
   * must handle a single oversized event).
   *
   * When `keepPaintBaseTogether` is true (segment 0), Meta immediately followed
   * by FullSnapshot is taken as one unit even if estimated size exceeds
   * maxBytes — gzip fitting / hard caps decide whether it can ship.
   */
  takeByEstimatedBytes(
    maxBytes: number,
    opts?: { keepPaintBaseTogether?: boolean },
  ): RrwebEvent[] {
    if (this.events.length === 0) return [];

    const batch: RrwebEvent[] = [];
    let batchBytes = 0;

    if (opts?.keepPaintBaseTogether) {
      const paintLen = this.paintBaseLength();
      if (paintLen > 0) {
        for (let i = 0; i < paintLen; i++) {
          const ev = this.events.shift()!;
          batch.push(ev);
          batchBytes += estimateJsonBytes(ev);
        }
        this.recomputeBytes();
      }
    }

    while (this.events.length > 0) {
      const next = this.events[0]!;
      const nextBytes = estimateJsonBytes(next);
      if (batch.length > 0 && batchBytes + nextBytes > maxBytes) {
        break;
      }
      this.events.shift();
      batch.push(next);
      batchBytes += nextBytes;
      // First event alone may exceed maxBytes — still emit it.
      if (batch.length === 1 && nextBytes >= maxBytes) {
        break;
      }
    }

    this.recomputeBytes();
    return batch;
  }

  takeAll(): RrwebEvent[] {
    const batch = this.events;
    this.events = [];
    this.pendingBytes = 0;
    return batch;
  }

  /** Re-queue events at the front (failed upload retry / bisect remainder). */
  prepend(events: RrwebEvent[]): void {
    if (events.length === 0) return;
    this.events = events.concat(this.events);
    this.recomputeBytes();
  }

  clear(): void {
    this.events = [];
    this.pendingBytes = 0;
  }

  peekTimes(): { startedAt: Date; endedAt: Date } | null {
    if (this.events.length === 0) return null;
    const first = this.events[0]!;
    const last = this.events[this.events.length - 1]!;
    return {
      startedAt: new Date(first.timestamp),
      endedAt: new Date(last.timestamp),
    };
  }

  private recomputeBytes(): void {
    this.pendingBytes = estimateJsonBytes(this.events);
  }
}
