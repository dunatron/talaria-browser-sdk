/** Which ingest path a permanent error applies to. */
export type IngestSignal = 'events' | 'spans' | 'replay';

/** Thrown by {@link ServerpodTransport} when an ingest RPC fails. */
export class TransportError extends Error {
  readonly status: number;
  readonly className: string | null;
  readonly retry: boolean | null;
  readonly bodyMessage: string | null;

  constructor(
    message: string,
    opts: {
      status: number;
      className?: string | null;
      retry?: boolean | null;
      bodyMessage?: string | null;
    },
  ) {
    super(message);
    this.name = 'TransportError';
    this.status = opts.status;
    this.className = opts.className ?? null;
    this.retry = opts.retry ?? null;
    this.bodyMessage = opts.bodyMessage ?? null;
  }
}

/** Classification of a Talaria ingest HTTP error body. */
export class IngestError {
  readonly className: string | null;
  readonly message: string | null;
  readonly retry: boolean | null;

  constructor(opts?: {
    className?: string | null;
    message?: string | null;
    retry?: boolean | null;
  }) {
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
      const nested =
        map.data && typeof map.data === 'object'
          ? (map.data as Record<string, unknown>)
          : {};
      return new IngestError({
        className: stringOf(
          map.__className__ ?? map.className ?? map.exception ?? nested.__className__,
        ),
        message: stringOf(map.message ?? nested.message),
        retry: boolOf(map.retry ?? nested.retry),
      });
    } catch {
      return new IngestError();
    }
  }

  static fromUnknown(error: unknown): IngestError {
    if (error instanceof TransportError) {
      return new IngestError({
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
