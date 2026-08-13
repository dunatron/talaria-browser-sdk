export interface SpanContext {
  traceId: string;
  spanId: string;
  sampled: boolean;
}

let current: SpanContext | null = null;

export function getCurrentSpanContext(): SpanContext | null {
  return current;
}

export function setCurrentSpanContext(ctx: SpanContext | null): void {
  current = ctx;
}
