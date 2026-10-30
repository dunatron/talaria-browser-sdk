import type { IngestTransport } from './http_transport.js';
import { bytesToBase64, gzipBytes } from '../utils/gzip.js';
import { MAX_COMPRESSED_SEGMENT_BYTES } from '../replay/segment_buffer.js';

export interface StartReplayParams {
  replayId: string;
  environment: string;
  sessionId?: string;
  url?: string;
  userId?: string;
  userAgent?: string;
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
  transport: IngestTransport,
  params: StartReplayParams,
): Promise<unknown> {
  const body: Record<string, unknown> = {
    replayId: params.replayId,
  };
  if (params.sessionId) body.sessionId = params.sessionId;
  if (params.url) body.url = params.url;
  if (params.userId) body.userId = params.userId;
  if (params.userAgent) body.userAgent = params.userAgent;

  return transport.postJson('/v1/replays', body, {
    keepalive: params.keepalive,
    label: 'v1/replays',
  });
}

export async function ingestReplaySegment(
  transport: IngestTransport,
  params: IngestSegmentParams,
): Promise<unknown> {
  const compressed =
    params.gzip ?? (await compressReplayEvents(params.events));

  if (compressed.length > MAX_COMPRESSED_SEGMENT_BYTES) {
    throw new Error(
      `Talaria v1/replays/segments failed: HTTP 400 — segment exceeds max compressed size (${compressed.length} > ${MAX_COMPRESSED_SEGMENT_BYTES})`,
    );
  }

  const segment = {
    replayId: params.replayId,
    segmentIndex: params.segmentIndex,
    gzipBytes: bytesToBase64(compressed),
    eventCount: params.events.length,
    startedAt: params.startedAt.toISOString(),
    endedAt: params.endedAt.toISOString(),
  };

  return transport.postJson(
    '/v1/replays/segments',
    { segments: [segment] },
    { keepalive: params.keepalive, label: 'v1/replays/segments' },
  );
}

export async function finishReplay(
  transport: IngestTransport,
  params: FinishReplayParams,
): Promise<unknown> {
  const body: Record<string, unknown> = {};
  if (params.reason) body.reason = params.reason;

  return transport.postJson(
    `/v1/replays/${encodeURIComponent(params.replayId)}/finish`,
    body,
    { keepalive: params.keepalive, label: 'v1/replays/finish' },
  );
}
