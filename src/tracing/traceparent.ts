import { isSpanId, isTraceId } from './ids.js';
import type { SpanContext } from './context.js';

const TRACEPARENT_RE =
  /^[\s]*([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})[\s]*$/i;

export interface TraceParent {
  version: string;
  traceId: string;
  spanId: string;
  sampled: boolean;
}

/** Parse a W3C `traceparent` header. Returns null when invalid / all-zero ids. */
export function parseTraceparent(header: string | null | undefined): TraceParent | null {
  if (!header) return null;
  const match = TRACEPARENT_RE.exec(header);
  if (!match) return null;
  const version = match[1]!.toLowerCase();
  const traceId = match[2]!.toLowerCase();
  const spanId = match[3]!.toLowerCase();
  const flags = match[4]!.toLowerCase();
  if (version === 'ff') return null;
  if (!isTraceId(traceId) || !isSpanId(spanId)) return null;
  if (/^0+$/.test(traceId) || /^0+$/.test(spanId)) return null;
  const sampled = (parseInt(flags, 16) & 0x01) === 1;
  return { version, traceId, spanId, sampled };
}

export function formatTraceparent(ctx: Pick<SpanContext, 'traceId' | 'spanId' | 'sampled'>): string {
  const flags = ctx.sampled ? '01' : '00';
  return `00-${ctx.traceId.toLowerCase()}-${ctx.spanId.toLowerCase()}-${flags}`;
}

export function extractTraceparent(
  headers: Headers | Record<string, string> | undefined,
): TraceParent | null {
  if (!headers) return null;
  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    return parseTraceparent(headers.get('traceparent'));
  }
  const record = headers as Record<string, string>;
  const raw =
    record.traceparent ??
    record.Traceparent ??
    record['TRACEPARENT'];
  return parseTraceparent(raw);
}

export function toSpanContext(parent: TraceParent): SpanContext {
  return {
    traceId: parent.traceId,
    spanId: parent.spanId,
    sampled: parent.sampled,
  };
}
