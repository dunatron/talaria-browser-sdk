import type {
  IngestSpanParams,
  SpanEventInput,
  SpanKind,
  SpanLinkInput,
  SpanStatus,
} from '../transport/spans.js';
import type { SpanContext } from './context.js';

const MAX_ATTRIBUTE_CHARS = 256;
const MAX_ATTRIBUTES = 64;

export interface MutableSpan {
  context: SpanContext;
  parentSpanId?: string;
  name: string;
  kind: SpanKind;
  startTime: Date;
  endTime?: Date;
  status: SpanStatus;
  statusMessage?: string;
  attributes: Record<string, string>;
  events: SpanEventInput[];
  links: SpanLinkInput[];
  ended: boolean;
  flushed: boolean;
}

export interface Span {
  readonly context: SpanContext;
  setAttribute(key: string, value: string | number | boolean): this;
  setAttributes(attrs: Record<string, string | number | boolean>): this;
  addEvent(name: string, attributes?: Record<string, string | number | boolean>): this;
  setStatus(status: SpanStatus, message?: string): this;
  end(endTime?: Date): void;
  isEnded(): boolean;
}

export class RecordingSpan implements Span {
  readonly data: MutableSpan;
  private readonly onEnd: (span: RecordingSpan) => void;

  constructor(
    data: MutableSpan,
    onEnd: (span: RecordingSpan) => void,
  ) {
    this.data = data;
    this.onEnd = onEnd;
  }

  get context(): SpanContext {
    return this.data.context;
  }

  setAttribute(key: string, value: string | number | boolean): this {
    if (this.data.flushed) return this;
    if (Object.keys(this.data.attributes).length >= MAX_ATTRIBUTES) return this;
    this.data.attributes[key] = stringifyAttr(value);
    return this;
  }

  setAttributes(attrs: Record<string, string | number | boolean>): this {
    for (const [key, value] of Object.entries(attrs)) {
      this.setAttribute(key, value);
    }
    return this;
  }

  addEvent(
    name: string,
    attributes?: Record<string, string | number | boolean>,
  ): this {
    if (this.data.flushed) return this;
    const event: SpanEventInput = {
      timestamp: new Date().toISOString(),
      name,
    };
    if (attributes && Object.keys(attributes).length) {
      event.attributes = stringifyAttrMap(attributes);
    }
    this.data.events.push(event);
    return this;
  }

  setStatus(status: SpanStatus, message?: string): this {
    if (this.data.flushed) return this;
    this.data.status = status;
    if (message) this.data.statusMessage = message.slice(0, MAX_ATTRIBUTE_CHARS);
    return this;
  }

  end(endTime?: Date): void {
    if (this.data.ended) return;
    this.data.ended = true;
    this.data.endTime = endTime ?? new Date();
    this.onEnd(this);
  }

  isEnded(): boolean {
    return this.data.ended;
  }
}

export class NoopSpan implements Span {
  readonly context: SpanContext;

  constructor(context: SpanContext) {
    this.context = context;
  }

  setAttribute(): this {
    return this;
  }

  setAttributes(): this {
    return this;
  }

  addEvent(): this {
    return this;
  }

  setStatus(): this {
    return this;
  }

  end(): void {}

  isEnded(): boolean {
    return true;
  }
}

export function toIngestSpan(
  span: MutableSpan,
  extras: {
    resource: Record<string, string>;
    environment?: string;
    release?: string;
    userId?: string;
    sessionId?: string;
    replayId?: string;
  },
): IngestSpanParams {
  const start = span.startTime.toISOString();
  const end = (span.endTime ?? new Date()).toISOString();
  const params: IngestSpanParams = {
    traceId: span.context.traceId,
    spanId: span.context.spanId,
    name: span.name,
    kind: span.kind,
    startTime: start,
    endTime: end < start ? start : end,
    status: span.status,
    attributes: { ...span.attributes },
    resource: { ...extras.resource },
    events: span.events.map((event) => ({ ...event })),
    environment: extras.environment,
    release: extras.release,
    userId: extras.userId,
    sessionId: extras.sessionId,
    replayId: extras.replayId,
  };
  if (span.parentSpanId) params.parentSpanId = span.parentSpanId;
  if (span.statusMessage) params.statusMessage = span.statusMessage;
  if (span.links.length) params.links = span.links.map((l) => ({ ...l }));
  return params;
}

export function stringifyAttr(value: string | number | boolean): string {
  const raw = typeof value === 'string' ? value : String(value);
  if (raw.length <= MAX_ATTRIBUTE_CHARS) return raw;
  return raw.slice(0, MAX_ATTRIBUTE_CHARS);
}

export function stringifyAttrMap(
  attrs: Record<string, string | number | boolean | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined) continue;
    out[key] = stringifyAttr(value);
  }
  return out;
}
