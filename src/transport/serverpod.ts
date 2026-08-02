export interface ServerpodTransportOptions {
  baseUrl: string;
  apiKey: string;
}

/**
 * Minimal Serverpod RPC client: POST `{baseUrl}/{endpoint}/{method}` with
 * named JSON parameters and API-key auth.
 */
export class ServerpodTransport {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(options: ServerpodTransportOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
  }

  async call(
    endpoint: string,
    method: string,
    body: Record<string, unknown>,
    opts?: { keepalive?: boolean },
  ): Promise<unknown> {
    const url = `${this.baseUrl}/${endpoint}/${method}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json; charset=utf-8',
      // Single auth header — dual headers widen CORS preflight and break older
      // Serverpod allow-lists that omit X-API-Key.
      'X-API-Key': this.apiKey,
    };

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      keepalive: opts?.keepalive ?? false,
      credentials: 'omit',
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      // Prefer Serverpod exception class + message when present (oversized, etc.).
      let detail = text.slice(0, 400);
      try {
        const parsed = JSON.parse(text) as {
          className?: string;
          message?: string;
          exception?: string;
        };
        const className = parsed.className ?? parsed.exception;
        const message = parsed.message;
        if (className || message) {
          detail = [className, message].filter(Boolean).join(': ');
        }
      } catch {
        // keep raw text
      }
      throw new Error(
        `Talaria ${endpoint}/${method} failed: HTTP ${response.status}${detail ? ` — ${detail}` : ''}`,
      );
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      return response.json();
    }
    return undefined;
  }
}
