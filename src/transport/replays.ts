import type { ServerpodTransport } from './serverpod.js';
import { gzipBytes, toServerpodByteData } from '../utils/gzip.js';
import { MAX_COMPRESSED_SEGMENT_BYTES } from '../replay/segment_buffer.js';

export interface StartReplayParams {
  replayId: string;
  environment: string;
  sessionId?: string;
  url?: string;
  userId?: string;
  keepalive?: boolean;
}

export interface IngestSegmentParams {
  replayId: string;
  segmentIndex: number;
  events: unknown[];
  startedAt: Date;
  endedAt: Date;
  keepalive?: boolean;
  /** Precomputed gzip payload; when set, `events` is only used for eventCount. */
  gzip?: Uint8Array;
}

export interface FinishReplayParams {
  replayId: string;
  reason?: string;
  keepalive?: boolean;
}

export async function compressReplayEvents(
  events: unknown[],
): Promise<Uint8Array> {
  const json = JSON.stringify(events);
  return gzipBytes(new TextEncoder().encode(json));
}

export async function startReplay(
  transport: ServerpodTransport,
  params: StartReplayParams,
): Promise<unknown> {
  const input: Record<string, unknown> = {
    __className__: 'StartReplayInput',
    replayId: params.replayId,
    environment: params.environment,
  };
  if (params.sessionId) input.sessionId = params.sessionId;
  if (params.url) input.url = params.url;
  if (params.userId) input.userId = params.userId;

  return transport.call(
    'replays',
    'start',
    { input },
    { keepalive: params.keepalive },
  );
}

export async function ingestReplaySegment(
  transport: ServerpodTransport,
  params: IngestSegmentParams,
): Promise<unknown> {
  const compressed =
    params.gzip ?? (await compressReplayEvents(params.events));

  if (compressed.length > MAX_COMPRESSED_SEGMENT_BYTES) {
    throw new Error(
      `Talaria replays/ingestSegment failed: HTTP 400 — segment exceeds max compressed size (${compressed.length} > ${MAX_COMPRESSED_SEGMENT_BYTES})`,
    );
  }

  const input = {
    __className__: 'IngestReplaySegmentInput',
    replayId: params.replayId,
    segmentIndex: params.segmentIndex,
    gzipBytes: toServerpodByteData(compressed),
    eventCount: params.events.length,
    startedAt: params.startedAt.toISOString(),
    endedAt: params.endedAt.toISOString(),
  };

  return transport.call(
    'replays',
    'ingestSegment',
    { input },
    { keepalive: params.keepalive },
  );
}

export async function finishReplay(
  transport: ServerpodTransport,
  params: FinishReplayParams,
): Promise<unknown> {
  const input: Record<string, unknown> = {
    __className__: 'FinishReplayInput',
    replayId: params.replayId,
  };
  if (params.reason) input.reason = params.reason;

  return transport.call(
    'replays',
    'finish',
    { input },
    { keepalive: params.keepalive },
  );
}
