/** Which ingest path a permanent error applies to. */
export type IngestSignal = 'events' | 'spans' | 'replay';

const PERMANENT_CODES = new Set([
  'invalid_key',
  'not_found',
  'insufficient_scope',
  'invalid_scope',
  'wrong_cell',
  'invalid_body',
  'invalid_release',
]);

/** Thrown by {@link IngestTransport} when an ingest request fails. */
export class TransportError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly className: string | null;
  readonly retry: boolean | null;
  readonly bodyMessage: string | null;

  constructor(
    message: string,
    opts: {
      status: number;
      code?: string | null;
      className?: string | null;
      retry?: boolean | null;
      bodyMessage?: string | null;
    },
  ) {
    super(message);
    this.name = 'TransportError';
    this.status = opts.status;
    this.code = opts.code ?? null;
    this.className = opts.className ?? null;
    this.retry = opts.retry ?? null;
    this.bodyMessage = opts.bodyMessage ?? null;
  }
}

/** Classification of a Talaria ingest HTTP error body. */
export class IngestError {
  readonly code: string | null;
  readonly className: string | null;
  readonly message: string | null;
  readonly retry: boolean | null;

  constructor(opts?: {
    code?: string | null;
    className?: string | null;
    message?: string | null;
    retry?: boolean | null;
  }) {
    this.code = opts?.code ?? null;
    this.className = opts?.className ?? null;
    this.message = opts?.message ?? null;
    this.retry = opts?.retry ?? null;
  }

  static parse(body: string): IngestError {
    try {
      const decoded = JSON.parse(body) as unknown;
      if (!decoded || typeof decoded !== 'object') {
        return new IngestError();
      }
      const map = decoded as Record<string, unknown>;
      const code = stringOf(map.code);
      if (code) {
        let retry: boolean | null = null;
        if (PERMANENT_CODES.has(code)) {
          retry = false;
        } else if (code === 'rate_limited' || code === 'quota_exceeded') {
          retry = true;
        }
        return new IngestError({
          code,
          message: stringOf(map.detail ?? map.title ?? map.message),
          retry,
        });
      }

      const nested =
        map.data && typeof map.data === 'object'
          ? (map.data as Record<string, unknown>)
          : {};
      return new IngestError({
        className: stringOf(
          map.__className__ ??
            map.className ??
            map.exception ??
            nested.__className__,
        ),
        message: stringOf(map.message ?? nested.message ?? map.detail),
        retry: boolOf(map.retry ?? nested.retry),
      });
    } catch {
      return new IngestError();
    }
  }

  static fromUnknown(error: unknown): IngestError {
    if (error instanceof TransportError) {
      return new IngestError({
        code: error.code,
        className: error.className,
        message: error.bodyMessage,
        retry: error.retry,
      });
    }
    return new IngestError();
  }

  /**
   * Permanent failures: dead API key, missing project, disallowed origin.
   * Quota / rate-limit / 5xx are never permanent.
   */
  get isPermanent(): boolean {
    if (this.retry === true) return false;
    if (this.code != null && PERMANENT_CODES.has(this.code)) return true;
    if (this.code === 'rate_limited' || this.code === 'quota_exceeded') {
      return false;
    }
    if (this.retry === false) return true;
    const name = this.className ?? '';
    if (name.includes('ApiUnauthorizedException')) return true;
    if (name.includes('ApiDisallowedDomainException')) return true;
    if (name.includes('ApiNotFoundException')) return true;
    if (
      name.includes('ApiConflictException') &&
      (this.message ?? '').toLowerCase().includes('not active')
    ) {
      return true;
    }
    return false;
  }

  /** Missing a single scope — disable that signal only. */
  get isScopeOnly(): boolean {
    if (this.code === 'insufficient_scope') return true;
    return (this.message ?? '').toLowerCase().includes('lacks required scope');
  }
}

function stringOf(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function boolOf(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    switch (value.toLowerCase().trim()) {
      case 'true':
      case '1':
        return true;
      case 'false':
      case '0':
        return false;
      default:
        return null;
    }
  }
  return null;
}
