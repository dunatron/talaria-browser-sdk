import type { NetworkMeta } from '../replay/hooks.js';
import { networkUrlParts } from '../replay/hooks.js';
import type { ServerpodTransport } from '../transport/serverpod.js';
import {
  ingestSpanBatch,
  type IngestSpanParams,
  type SpanKind,
} from '../transport/spans.js';
import {
  getCurrentSpanContext,
  setCurrentSpanContext,
  type SpanContext,
} from './context.js';
import { createSpanId, createTraceId } from './ids.js';
import { headSample, shouldKeepTransaction } from './sampling.js';
import {
  NoopSpan,
  RecordingSpan,
  stringifyAttrMap,
  toIngestSpan,
  type Span,
} from './span.js';
import type { SpanStatus } from '../transport/spans.js';
import type { WebVital } from '../integrations/web_vitals.js';

/** Server rejects more than 200 spans in one transaction. */
export const MAX_SPANS_PER_TRANSACTION = 200;
const AUTO_FLUSH_ENDED = 16;

export interface TracerOptions {
  transport: ServerpodTransport;
  sampleRate: number;
  resource: Record<string, string>;
  environment: string;
  release?: string;
  userId?: string;
  getSessionId: () => string | null;
  getReplayId: () => string | null;
}

export interface StartSpanOptions {
  kind?: SpanKind;
  parent?: SpanContext | null;
  attributes?: Record<string, string | number | boolean>;
  startTime?: Date;
}

export class Tracer {
  private readonly options: TracerOptions;
  private sampled = false;
  private hasError = false;
  private spanCount = 0;
  private pageload: RecordingSpan | null = null;
  private readonly ended: RecordingSpan[] = [];
  private flushChain: Promise<void> = Promise.resolve();
  private disabled = false;

  constructor(options: TracerOptions) {
    this.options = options;
  }

  isSampled(): boolean {
    return shouldKeepTransaction(this.sampled, this.hasError);
  }

  getTraceId(): string | null {
    return getCurrentSpanContext()?.traceId ?? this.pageload?.context.traceId ?? null;
  }

  getSpanId(): string | null {
    return getCurrentSpanContext()?.spanId ?? this.pageload?.context.spanId ?? null;
  }

  getActiveContext(): SpanContext | null {
    return getCurrentSpanContext();
  }

  markError(): void {
    this.hasError = true;
    const ctx = getCurrentSpanContext();
    if (ctx && !ctx.sampled) {
      setCurrentSpanContext({ ...ctx, sampled: true });
    }
    if (this.pageload) {
      this.pageload.data.context = {
        ...this.pageload.data.context,
        sampled: true,
      };
      if (this.pageload.data.status === 'unset') {
        this.pageload.setStatus('error');
      }
    }
    this.sampled = true;
  }

  startPageload(opts?: { name?: string; url?: string }): Span {
    const traceId = createTraceId();
    const spanId = createSpanId();
    this.sampled = headSample(this.options.sampleRate);
    this.hasError = false;
    this.spanCount = 0;
    this.ended.length = 0;

    const ctx: SpanContext = {
      traceId,
      spanId,
      sampled: this.sampled,
    };
    setCurrentSpanContext(ctx);

    const attributes: Record<string, string | number | boolean> = {
      'talaria.transaction': 'pageload',
    };
    if (opts?.url) attributes['url.full'] = opts.url;
    if (opts?.name) attributes['url.path'] = opts.name;

    const span = this.createSpan(opts?.name || 'pageload', {
      kind: 'internal',
      parent: null,
      attributes,
      startTime: pageloadStartTime(),
      context: ctx,
    });
    this.pageload = span instanceof RecordingSpan ? span : null;
    return span;
  }

  startSpan(name: string, opts?: StartSpanOptions): Span | null {
    const parent = opts?.parent === undefined ? getCurrentSpanContext() : opts.parent;
    if (!parent) return null;
    return this.createSpan(name, { ...opts, parent });
  }

  recordHttpSpan(
    meta: NetworkMeta,
    opts?: { includeQuery?: boolean; pageOrigin?: string },
  ): void {
    const parent = getCurrentSpanContext();
    if (!parent) return;
    if (this.spanCount >= MAX_SPANS_PER_TRANSACTION) return;

    const includeQuery = opts?.includeQuery ?? false;
    const parts = {
      url: meta.url,
      hostname: meta.hostname,
      pathname: meta.pathname,
      origin: meta.origin,
    };
    if (!parts.pathname && meta.url) {
      const parsed = networkUrlParts(meta.url, includeQuery, opts?.pageOrigin);
      parts.url = parsed.url;
      parts.hostname = parsed.hostname;
      parts.pathname = parsed.pathname;
      parts.origin = parsed.origin;
    }

    const method = (meta.method || 'GET').toUpperCase();
    const path = parts.pathname || '/';
    const startTime =
      typeof meta.durationMs === 'number'
        ? new Date(Date.now() - Math.max(0, meta.durationMs))
        : new Date();

    const span = this.createSpan(`${method} ${path}`, {
      kind: 'client',
      parent,
      startTime,
      attributes: httpSpanAttributes(meta, parts),
    });
    if (!span) return;

    if (meta.failureKind === 'network' || meta.failureKind === 'timeout') {
      span.setStatus('error', meta.errorMessage || meta.failureKind);
      this.markError();
    } else if (typeof meta.status === 'number' && meta.status >= 500) {
      span.setStatus('error', `HTTP ${meta.status}`);
      this.markError();
    } else if (meta.ok) {
      span.setStatus('ok');
    } else if (meta.aborted || meta.failureKind === 'abort') {
      span.setStatus('unset', 'aborted');
    } else {
      span.setStatus('unset');
    }
    span.end();
  }

  recordWebVital(vital: WebVital): void {
    const value = formatVitalValue(vital);
    const attrs = { [vital.name]: value };
    if (this.pageload && !this.pageload.data.flushed) {
      this.pageload.setAttribute(vital.name, value);
      this.pageload.addEvent(vital.name, attrs);
      return;
    }
    const child = this.startSpan(`webvital.${vital.name}`, {
      kind: 'internal',
      attributes: attrs,
    });
    child?.end();
  }

  endPageload(): void {
    if (!this.pageload || this.pageload.isEnded()) return;
    if (this.pageload.data.status === 'unset' && this.isSampled() && !this.hasError) {
      this.pageload.setStatus('ok');
    }
    this.pageload.end();
  }

  flush(opts?: { keepalive?: boolean }): Promise<void> {
    this.flushChain = this.flushChain.then(
      () => this.flushOnce(opts),
      () => this.flushOnce(opts),
    );
    return this.flushChain;
  }

  async shutdown(): Promise<void> {
    this.endPageload();
    await this.flush({ keepalive: false });
    setCurrentSpanContext(null);
    this.pageload = null;
    this.ended.length = 0;
    this.spanCount = 0;
  }

  private createSpan(
    name: string,
    opts: StartSpanOptions & { parent?: SpanContext | null; context?: SpanContext },
  ): Span {
    if (this.spanCount >= MAX_SPANS_PER_TRANSACTION) {
      return new NoopSpan(
        opts.context ?? {
          traceId: opts.parent?.traceId ?? createTraceId(),
          spanId: createSpanId(),
          sampled: this.isSampled(),
        },
      );
    }

    const parent = opts.parent;
    const ctx =
      opts.context ??
      ({
        traceId: parent?.traceId ?? createTraceId(),
        spanId: createSpanId(),
        sampled: this.isSampled(),
      } satisfies SpanContext);

    this.spanCount += 1;
    const data = {
      context: ctx,
      parentSpanId: parent && parent.spanId !== ctx.spanId ? parent.spanId : undefined,
      name,
      kind: opts.kind ?? 'internal',
      startTime: opts.startTime ?? new Date(),
      status: 'unset' as SpanStatus,
      attributes: opts.attributes ? stringifyAttrMap(opts.attributes) : {},
      events: [],
      links: [],
      ended: false,
      flushed: false,
    };
    return new RecordingSpan(data, (span) => this.onSpanEnd(span));
  }

  private onSpanEnd(span: RecordingSpan): void {
    this.ended.push(span);
    if (this.ended.length >= AUTO_FLUSH_ENDED && this.isSampled()) {
      void this.flush();
    }
  }

  private async flushOnce(opts?: { keepalive?: boolean }): Promise<void> {
    if (this.disabled) {
      this.ended.length = 0;
      return;
    }
    if (!shouldKeepTransaction(this.sampled, this.hasError)) {
      return;
    }

    const ready = this.ended.filter((span) => span.isEnded() && !span.data.flushed);
    if (ready.length === 0) return;

    const extras = {
      resource: this.options.resource,
      environment: this.options.environment,
      release: this.options.release,
      userId: this.options.userId,
      sessionId: this.options.getSessionId() ?? undefined,
      replayId: this.options.getReplayId() ?? undefined,
    };

    const payload: IngestSpanParams[] = ready.map((span) => {
      span.data.flushed = true;
      return toIngestSpan(span.data, extras);
    });

    try {
      await ingestSpanBatch(this.options.transport, payload, {
        keepalive: opts?.keepalive,
      });
    } catch (error) {
      for (const span of ready) span.data.flushed = false;
      console.warn('@newtalaria/browser: spans/ingestBatch failed', error);
      const msg = error instanceof Error ? error.message : String(error);
      const match = /Talaria spans\/ingestBatch failed: HTTP (\d{3})/.exec(msg);
      const status = match ? Number(match[1]) : 0;
      if (status >= 400 && status < 500 && status !== 408 && status !== 429) {
        this.disabled = true;
        this.ended.length = 0;
        console.warn(
          '@newtalaria/browser: span ingest disabled after permanent client error',
          error,
        );
      }
    }
  }
}

function pageloadStartTime(): Date {
  if (typeof performance === 'undefined') return new Date();
  const origin =
    typeof performance.timeOrigin === 'number' ? performance.timeOrigin : Date.now();
  try {
    const entries = performance.getEntriesByType?.('navigation');
    const nav = entries?.[0] as { startTime?: number } | undefined;
    if (nav && typeof nav.startTime === 'number') {
      return new Date(origin + nav.startTime);
    }
  } catch {
    // ignore
  }
  return new Date(origin);
}

function httpSpanAttributes(
  meta: NetworkMeta,
  parts: { url?: string; hostname?: string; pathname?: string; origin?: string },
): Record<string, string | number | boolean> {
  const attrs: Record<string, string | number | boolean> = {
    'http.request.method': (meta.method || 'GET').toUpperCase(),
  };
  if (parts.url) attrs['url.full'] = parts.url;
  if (parts.pathname) attrs['url.path'] = parts.pathname;
  if (parts.hostname) attrs['server.address'] = parts.hostname;
  if (typeof meta.status === 'number' && meta.status > 0) {
    attrs['http.response.status_code'] = meta.status;
  }
  if (meta.failureKind) attrs['error.type'] = meta.failureKind;
  return attrs;
}

function formatVitalValue(vital: WebVital): string {
  if (vital.name === 'cls') return vital.value.toFixed(4);
  return String(Math.round(vital.value * 10) / 10);
}
