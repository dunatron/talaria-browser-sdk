const SENSITIVE_QUERY_KEY =
  /^(?:token|secret|password|auth|api[_-]?key|access[_-]?token|gclid|fbclid|gcl_au|msclkid|_ga(?:_.*)?|cid|sid)$/i;

const SENSITIVE_QUERY_LEGACY =
  /(?:^|[?&])(token|secret|password|auth|api[_-]?key|access[_-]?token|gclid|fbclid|gcl_au|msclkid|_ga(?:_[^=&#]*)?|cid|sid)=([^&#]*)/gi;

function isSensitiveQueryKey(key: string): boolean {
  return SENSITIVE_QUERY_KEY.test(key);
}

/** Redact sensitive / tracking query params from a URL (keeps other query keys). */
export function redactUrl(raw: string): string {
  try {
    const url = new URL(raw, typeof location !== 'undefined' ? location.href : undefined);
    for (const key of [...url.searchParams.keys()]) {
      if (isSensitiveQueryKey(key)) {
        url.searchParams.set(key, '[Filtered]');
      }
    }
    return url.toString();
  } catch {
    return raw.replace(SENSITIVE_QUERY_LEGACY, (_m, name: string) => `${name}=[Filtered]`);
  }
}

export interface SanitizedNetworkUrl {
  /** Safe URL for telemetry: origin + pathname (no query/hash by default). */
  url: string;
  hostname: string;
  pathname: string;
  /** Present only when query capture is opted in (after sensitive-key redaction). */
  search?: string;
}

/**
 * Sanitize a request URL for network breadcrumbs / failure events.
 * Default: drop query string and fragment (GA/ads URLs carry session ids).
 * Opt-in `includeQuery` keeps search after `redactUrl` filtering.
 */
export function sanitizeNetworkUrl(
  raw: string,
  opts?: { includeQuery?: boolean; baseHref?: string },
): SanitizedNetworkUrl {
  const baseHref =
    opts?.baseHref ??
    (typeof location !== 'undefined' ? location.href : undefined);

  try {
    const parsed = new URL(raw, baseHref);
    const hostname = parsed.hostname;
    const pathname = parsed.pathname || '/';
    const originPath = `${parsed.origin}${pathname}`;

    if (!opts?.includeQuery) {
      return { url: originPath, hostname, pathname };
    }

    const redacted = new URL(redactUrl(parsed.toString()));
    const search = redacted.search || undefined;
    return {
      url: search ? `${originPath}${search}` : originPath,
      hostname,
      pathname,
      ...(search ? { search } : {}),
    };
  } catch {
    const stripped = (raw.split(/[?#]/)[0] ?? raw).trim() || raw;
    if (!opts?.includeQuery) {
      return { url: stripped, hostname: '', pathname: stripped };
    }
    const redacted = redactUrl(raw);
    const qIndex = redacted.indexOf('?');
    const search = qIndex >= 0 ? redacted.slice(qIndex) : undefined;
    return {
      url: redacted.split('#')[0] || redacted,
      hostname: '',
      pathname: stripped,
      ...(search ? { search } : {}),
    };
  }
}

export function defaultBlockSelector(extra?: string): string {
  const parts = [
    '[data-talaria-mask]',
    '.talaria-block',
    // Heavy docs surfaces (syntax-highlighted code) blow up FullSnapshots.
    'pre',
    'code',
  ];
  if (extra?.trim()) parts.push(extra.trim());
  return parts.join(', ');
}
