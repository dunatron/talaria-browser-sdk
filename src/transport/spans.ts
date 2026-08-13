import type { ServerpodTransport } from './serverpod.js';

export type SpanKind = 'internal' | 'server' | 'client' | 'producer' | 'consumer';
export type SpanStatus = 'unset' | 'ok' | 'error';

export interface SpanEventInput {
  timestamp: string;
  name: string;
  attributes?: Record<string, string>;
}

export interface SpanLinkInput {
  traceId: string;
  spanId: string;
}

export interface IngestSpanParams {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: SpanKind;
  startTime: string;
  endTime: string;
  status?: SpanStatus;
  statusMessage?: string;
  attributes?: Record<string, string>;
  resource?: Record<string, string>;
  events?: SpanEventInput[];
  links?: SpanLinkInput[];
  environment?: string;
  release?: string;
  userId?: string;
  sessionId?: string;
  replayId?: string;
  requestId?: string;
}

/**
 * Batch-ingest spans. Never mix with `events/ingest` — spans are a parallel path.
 *
 * `POST {baseUrl}/spans/ingestBatch` with `__className__: 'IngestSpanBatchInput'`.
 */
export async function ingestSpanBatch(
  transport: ServerpodTransport,
  spans: IngestSpanParams[],
  opts?: { keepalive?: boolean },
): Promise<unknown> {
  if (spans.length === 0) return undefined;

  const input: Record<string, unknown> = {
    __className__: 'IngestSpanBatchInput',
    spans: spans.map(serializeSpan),
  };

  return transport.call('spans', 'ingestBatch', { input }, {
    keepalive: opts?.keepalive,
  });
}

function serializeSpan(span: IngestSpanParams): Record<string, unknown> {
  const out: Record<string, unknown> = {
    __className__: 'IngestSpanInput',
    traceId: span.traceId,
    spanId: span.spanId,
    name: span.name,
    kind: span.kind,
    startTime: span.startTime,
    endTime: span.endTime,
  };
  if (span.parentSpanId) out.parentSpanId = span.parentSpanId;
  if (span.status) out.status = span.status;
  if (span.statusMessage) out.statusMessage = span.statusMessage;
  if (span.attributes && Object.keys(span.attributes).length) {
    out.attributes = span.attributes;
  }
  if (span.resource && Object.keys(span.resource).length) {
    out.resource = span.resource;
  }
  if (span.events && span.events.length) {
    out.events = span.events.map(serializeSpanEvent);
  }
  if (span.links && span.links.length) {
    out.links = span.links.map(serializeSpanLink);
  }
  if (span.environment) out.environment = span.environment;
  if (span.release) out.release = span.release;
  if (span.userId) out.userId = span.userId;
  if (span.sessionId) out.sessionId = span.sessionId;
  if (span.replayId) out.replayId = span.replayId;
  if (span.requestId) out.requestId = span.requestId;
  return out;
}

function serializeSpanEvent(event: SpanEventInput): Record<string, unknown> {
  const out: Record<string, unknown> = {
    __className__: 'SpanEventDto',
    timestamp: event.timestamp,
    name: event.name,
  };
  if (event.attributes && Object.keys(event.attributes).length) {
    out.attributes = event.attributes;
  }
  return out;
}

function serializeSpanLink(link: SpanLinkInput): Record<string, unknown> {
  return {
    __className__: 'SpanLinkDto',
    traceId: link.traceId,
    spanId: link.spanId,
  };
}
