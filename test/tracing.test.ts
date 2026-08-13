import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TalariaClient } from '../src/client.ts';

type Call = { url: string; body: Record<string, unknown>; headers: Headers };

function installFetchCapture(): { calls: Call[]; restore: () => void } {
  const calls: Call[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    } catch {
      body = {};
    }
    calls.push({ url, body, headers });
    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

function withLocation<T>(origin: string, fn: () => T): T {
  const href = `${origin}/checkout`;
  const fake = { origin, href, pathname: '/checkout' };
  const had = 'location' in globalThis;
  const previous = had ? globalThis.location : undefined;
  Object.defineProperty(globalThis, 'location', {
    value: fake,
    configurable: true,
    writable: true,
  });
  try {
    return fn();
  } finally {
    if (had) {
      Object.defineProperty(globalThis, 'location', {
        value: previous,
        configurable: true,
        writable: true,
      });
    } else {
      // @ts-expect-error cleanup
      delete globalThis.location;
    }
  }
}

describe('browser tracing', () => {
  it('does not send spans when tracing is off', async () => {
    const { calls, restore } = installFetchCapture();
    try {
      const client = new TalariaClient();
      client.init({
        dsn: 'http://localhost:8080',
        apiKey: 'tal_live_test',
        environment: 'development',
        replaysSessionSampleRate: 0,
        replaysOnErrorSampleRate: 0,
        disableDefaultIntegrations: true,
      });
      await client.captureException(new Error('boom'));
      await client.close();
      assert.equal(
        calls.some((c) => c.url.includes('/spans/')),
        false,
      );
      const event = calls.find((c) => c.url.includes('/events/ingest'));
      assert.ok(event);
      const input = event!.body.input as Record<string, unknown>;
      assert.equal(input.traceId, undefined);
    } finally {
      restore();
    }
  });

  it('injects traceparent on allowlisted fetches and records child spans', async () => {
    await withLocation('https://app.example.com', async () => {
      const { calls, restore } = installFetchCapture();
      try {
        const client = new TalariaClient();
        client.init({
          dsn: 'http://localhost:8080',
          apiKey: 'tal_live_test',
          environment: 'development',
          replaysSessionSampleRate: 0,
          replaysOnErrorSampleRate: 0,
          disableDefaultIntegrations: true,
          enableTracing: true,
          tracesSampleRate: 1,
          networkErrorOrigins: ['https://api.stripe.com'],
          tags: { service: 'storefront' },
        });

        await fetch('https://app.example.com/api/cart');
        await fetch('https://api.stripe.com/v1/tokens');
        await fetch('https://www.google-analytics.com/g/collect');

        const appCall = calls.find((c) => c.url === 'https://app.example.com/api/cart');
        const stripeCall = calls.find((c) => c.url === 'https://api.stripe.com/v1/tokens');
        const gaCall = calls.find((c) =>
          c.url.startsWith('https://www.google-analytics.com'),
        );
        assert.ok(appCall?.headers.get('traceparent'));
        assert.ok(stripeCall?.headers.get('traceparent'));
        assert.equal(gaCall?.headers.get('traceparent'), null);

        await client.captureException(new Error('checkout failed'));
        await client.close();

        const event = calls.find((c) => c.url.includes('/events/ingest'));
        assert.ok(event);
        const eventInput = event!.body.input as Record<string, unknown>;
        assert.equal(typeof eventInput.traceId, 'string');
        assert.equal(String(eventInput.traceId).length, 32);
        const crumbs = eventInput.breadcrumbs as Array<Record<string, unknown>>;
        assert.ok(Array.isArray(crumbs));
        assert.ok(crumbs.some((c) => c.category === 'fetch' && c.type === 'http'));
        assert.equal(crumbs[0]!.__className__, 'BreadcrumbDto');

        const spanCall = calls.find((c) => c.url.endsWith('/spans/ingestBatch'));
        assert.ok(spanCall);
        const spanInput = spanCall!.body.input as Record<string, unknown>;
        assert.equal(spanInput.__className__, 'IngestSpanBatchInput');
        const spans = spanInput.spans as Array<Record<string, unknown>>;
        assert.ok(spans.length >= 1);
        assert.equal(
          spans.some((s) => s.name === '/checkout' || s.name === 'pageload'),
          true,
        );
        const httpSpan = spans.find((s) => String(s.name).startsWith('GET /api/cart'));
        assert.ok(httpSpan);
        assert.equal(httpSpan!.kind, 'client');
        const attrs = httpSpan!.attributes as Record<string, string>;
        assert.equal(attrs['http.request.method'], 'GET');
        assert.equal(attrs['http.method'], undefined);
        assert.equal(
          spanCall!.url.includes('/events/'),
          false,
        );
      } finally {
        restore();
      }
    });
  });
});
