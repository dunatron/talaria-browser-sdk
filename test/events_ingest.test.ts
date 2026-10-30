import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { IngestTransport } from '../src/transport/http_transport.ts';
import { ingestEvent } from '../src/transport/events.ts';

describe('POST /v1/events transport', () => {
  it('POSTs a plain JSON events batch with X-API-Key', async () => {
    let url = '';
    let body: Record<string, unknown> | null = null;
    let apiKey = '';
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      url = String(input);
      apiKey = String(
        (init?.headers as Record<string, string> | undefined)?.['X-API-Key'] ??
          '',
      );
      body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    try {
      const transport = new IngestTransport({
        baseUrl: 'https://ingest-nz1.newtalaria.com',
        apiKey: 'tal_pk_prod_nz1_abc',
      });
      await ingestEvent(transport, {
        message: 'checkout started',
        environment: 'production',
        level: 'info',
        platform: 'javascript',
        timestamp: '2026-01-01T00:00:00.000Z',
      });

      assert.equal(url, 'https://ingest-nz1.newtalaria.com/v1/events');
      assert.equal(apiKey, 'tal_pk_prod_nz1_abc');
      assert.equal(JSON.stringify(body).includes('__className__'), false);
      assert.equal(JSON.stringify(body).includes('"input"'), false);
      const events = body!.events as Array<Record<string, unknown>>;
      assert.equal(events.length, 1);
      assert.equal(events[0]!.message, 'checkout started');
      assert.equal(events[0]!.level, 'info');
      assert.equal(events[0]!.eventType, 'info');
      assert.equal(events[0]!.platform, 'javascript');
      assert.equal(events[0]!.environment, undefined);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
