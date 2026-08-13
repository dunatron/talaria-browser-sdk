/** Default head sample rate for successful transactions when tracing is on. */
export const DEFAULT_TRACES_SAMPLE_RATE = 0.1;

export interface TracingSampleOptions {
  enableTracing?: boolean;
  tracesSampleRate?: number;
}

/**
 * Tracing stays off until `enableTracing: true` or `tracesSampleRate > 0`.
 * Explicit `enableTracing: false` wins.
 */
export function isTracingEnabled(opts: TracingSampleOptions): boolean {
  if (opts.enableTracing === false) return false;
  if (opts.enableTracing === true) return true;
  return (opts.tracesSampleRate ?? 0) > 0;
}

export function resolveTracesSampleRate(opts: TracingSampleOptions): number {
  if (!isTracingEnabled(opts)) return 0;
  if (opts.tracesSampleRate === undefined) return DEFAULT_TRACES_SAMPLE_RATE;
  return clamp01(opts.tracesSampleRate);
}

export function headSample(rate: number, rng: () => number = Math.random): boolean {
  if (rate <= 0) return false;
  if (rate >= 1) return true;
  return rng() < rate;
}

/** Head sample plus 100% of error transactions. */
export function shouldKeepTransaction(sampled: boolean, hasError: boolean): boolean {
  return sampled || hasError;
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, n));
}
