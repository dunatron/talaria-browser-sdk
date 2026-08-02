/** AbortError from fetch/XHR — usually intentional, not an app bug. */
export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

/** Explicit fetch/XHR timeout (AbortSignal.timeout / XHR timeout). */
export function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.name === 'TimeoutError';
}

/**
 * Browser fetch transport failures (CORS, offline, DNS, blocked).
 * These reject with TypeError / NetworkError — not HTTP status codes.
 * TimeoutError is handled separately via {@link isTimeoutError}.
 */
export function isLikelyNetworkFetchError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === 'AbortError' || error.name === 'TimeoutError') return false;
  if (error.name === 'NetworkError') return true;

  const msg = error.message.toLowerCase().trim();
  return (
    msg === 'failed to fetch' ||
    msg === 'load failed' ||
    msg === 'networkerror when attempting to fetch resource.' ||
    msg.startsWith('networkerror') ||
    msg.includes('failed to fetch')
  );
}

/** True when a bare rejection may correlate with instrumented network/timeout meta. */
export function isCorrelatableTransportError(error: unknown): boolean {
  return isLikelyNetworkFetchError(error) || isTimeoutError(error);
}

export function describeUnknownError(error: unknown): {
  errorName: string;
  errorMessage: string;
  aborted: boolean;
  timedOut: boolean;
} {
  if (error instanceof Error) {
    return {
      errorName: error.name || 'Error',
      errorMessage: (error.message || '').slice(0, 500),
      aborted: error.name === 'AbortError',
      timedOut: error.name === 'TimeoutError',
    };
  }
  return {
    errorName: 'Error',
    errorMessage: String(error).slice(0, 500),
    aborted: false,
    timedOut: false,
  };
}

/**
 * Classify a transport-layer failure.
 * Never maps status-0 / Failed to fetch → `cors` — browsers do not expose that
 * reliably (CORS, adblock, offline, DNS, privacy all look similar).
 */
export function classifyTransportFailure(opts: {
  aborted?: boolean;
  timedOut?: boolean;
  errorName?: string;
}): 'network' | 'abort' | 'timeout' {
  if (opts.aborted || opts.errorName === 'AbortError') return 'abort';
  if (opts.timedOut || opts.errorName === 'TimeoutError') return 'timeout';
  return 'network';
}
