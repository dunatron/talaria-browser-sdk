import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { IngestTransport } from '../src/transport/http_transport.ts';
import { ingestSpanBatch } from '../src/transport/spans.ts';

describe('POST /v1/spans transport', () => {
  it('POSTs plain JSON spans batch and does not use /v1/events', async () => {
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
      return new Response(JSON.stringify({ acceptedCount: 1, failedCount: 0, failures: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      const transport = new IngestTransport({
        baseUrl: 'https://ingest-nz1.newtalaria.com',
        apiKey: 'tal_pk_test_nz1_key',
      });
      await ingestSpanBatch(transport, [
        {
          traceId: 'a'.repeat(32),
          spanId: 'b'.repeat(16),
          name: 'pageload',
          kind: 'internal',
          startTime: '2026-01-01T00:00:00.000Z',
          endTime: '2026-01-01T00:00:01.000Z',
          status: 'ok',
          attributes: { lcp: '1200' },
          events: [
            {
              timestamp: '2026-01-01T00:00:00.500Z',
              name: 'lcp',
              attributes: { lcp: '1200' },
            },
          ],
        },
      ]);

      assert.equal(url, 'https://ingest-nz1.newtalaria.com/v1/spans');
      assert.equal(url.includes('/v1/events'), false);
      assert.equal(apiKey, 'tal_pk_test_nz1_key');
      assert.equal(JSON.stringify(body).includes('__className__'), false);
      const spans = body!.spans as Array<Record<string, unknown>>;
      assert.equal(spans.length, 1);
      assert.equal(spans[0]!.traceId, 'a'.repeat(32));
      assert.equal(spans[0]!.kind, 'internal');
      assert.equal(spans[0]!.status, 'ok');
      const events = spans[0]!.events as Array<Record<string, unknown>>;
      assert.equal(events[0]!.name, 'lcp');
      assert.equal(JSON.stringify(events[0]).includes('SpanEventDto'), false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('no-ops on an empty batch', async () => {
    let called = false;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      called = true;
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    try {
      const transport = new IngestTransport({
        baseUrl: 'http://localhost:8080',
        apiKey: 'tal_live_test',
      });
      await ingestSpanBatch(transport, []);
      assert.equal(called, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
