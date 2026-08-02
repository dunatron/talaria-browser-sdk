import { estimateJsonBytes } from '../utils/estimate.js';
import {
  MAX_COMPRESSED_SEGMENT_BYTES,
  RRWEB_FULL_SNAPSHOT,
  RRWEB_META,
  SEGMENT_SIZE_BYTES,
  TARGET_COMPRESSED_SEGMENT_BYTES,
  type RrwebEvent,
} from './segment_buffer.js';

/** Size diagnostics when segment 0 cannot ship a paint base. */
export type PaintBaseSizeDetails = {
  segmentEventTypes: number[];
  /** Estimated JSON bytes of the Meta event, if present. */
  metaEstimatedBytes?: number;
  /** Estimated JSON bytes of the FullSnapshot, if present. */
  fullSnapshotEstimatedBytes?: number;
  /** Actual gzip size of FullSnapshot alone, when measured. */
  fullSnapshotCompressedBytes?: number;
  /** Soft estimated take window (not the server uncompressed hard cap). */
  softTakeEstimatedBytes: number;
  targetCompressedSegmentBytes: number;
  maxCompressedSegmentBytes: number;
} & Record<string, unknown>;

export function paintBaseSizeDetails(
  events: RrwebEvent[],
  opts?: { fullSnapshotCompressedBytes?: number },
): PaintBaseSizeDetails {
  const meta = events.find((e) => e.type === RRWEB_META);
  const full = events.find((e) => e.type === RRWEB_FULL_SNAPSHOT);

  const details: PaintBaseSizeDetails = {
    segmentEventTypes: events.map((e) => e.type),
    softTakeEstimatedBytes: SEGMENT_SIZE_BYTES,
    targetCompressedSegmentBytes: TARGET_COMPRESSED_SEGMENT_BYTES,
    maxCompressedSegmentBytes: MAX_COMPRESSED_SEGMENT_BYTES,
  };

  if (meta) {
    details.metaEstimatedBytes = estimateJsonBytes(meta);
  }
  if (full) {
    details.fullSnapshotEstimatedBytes = estimateJsonBytes(full);
  }
  if (opts?.fullSnapshotCompressedBytes !== undefined) {
    details.fullSnapshotCompressedBytes = opts.fullSnapshotCompressedBytes;
  }

  return details;
}
