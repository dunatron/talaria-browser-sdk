import { IngestError, TransportError } from './ingest_error.js';

export interface IngestTransportOptions {
  baseUrl: string;
  apiKey: string;
}

/**
 * Minimal HTTP client for Talaria ingest `POST /v1/...` routes.
 * Auth: `X-API-Key` (browser publishable keys).
 */
export class IngestTransport {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(options: IngestTransportOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
  }

  async postJson(
    path: string,
    payload: Record<string, unknown>,
    opts?: { keepalive?: boolean; label?: string },
  ): Promise<unknown> {
    const normalized = path.startsWith('/') ? path : `/${path}`;
    const url = `${this.baseUrl}${normalized}`;
    const label = opts?.label ?? normalized.replace(/^\//, '');
    const headers: Record<string, string> = {
      'Content-Type': 'application/json; charset=utf-8',
      'X-API-Key': this.apiKey,
    };

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      keepalive: opts?.keepalive ?? false,
      credentials: 'omit',
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      const parsed = IngestError.parse(text);
      let detail = text.slice(0, 400);
      const code = parsed.code;
      const message = parsed.message;
      if (code || message) {
        detail = [code, message].filter(Boolean).join(': ');
      } else if (parsed.className) {
        detail = [parsed.className, message].filter(Boolean).join(': ');
      }
      throw new TransportError(
        `Talaria ${label} failed: HTTP ${response.status}${detail ? ` — ${detail}` : ''}`,
        {
          status: response.status,
          code: parsed.code,
          className: parsed.className,
          retry: parsed.retry,
          bodyMessage: parsed.message,
        },
      );
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      const text = await response.text();
      if (!text.trim()) return undefined;
      return JSON.parse(text);
    }
    return undefined;
  }
}
