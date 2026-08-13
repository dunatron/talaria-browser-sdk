import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ServerpodTransport } from '../src/transport/serverpod.ts';
import { ingestSpanBatch } from '../src/transport/spans.ts';

describe('spans/ingestBatch transport', () => {
  it('POSTs IngestSpanBatchInput and does not use events/ingest', async () => {
    let url = '';
    let body: Record<string, unknown> | null = null;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      url = String(input);
      body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      return new Response(JSON.stringify({ acceptedCount: 1, failedCount: 0, failures: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      const transport = new ServerpodTransport({
        baseUrl: 'http://localhost:8080',
        apiKey: 'tal_live_test',
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

      assert.equal(url, 'http://localhost:8080/spans/ingestBatch');
      assert.equal(url.includes('/events/'), false);
      const input = body!.input as Record<string, unknown>;
      assert.equal(input.__className__, 'IngestSpanBatchInput');
      const spans = input.spans as Array<Record<string, unknown>>;
      assert.equal(spans.length, 1);
      assert.equal(spans[0]!.__className__, 'IngestSpanInput');
      assert.equal(spans[0]!.traceId, 'a'.repeat(32));
      assert.equal(spans[0]!.kind, 'internal');
      assert.equal(spans[0]!.status, 'ok');
      const events = spans[0]!.events as Array<Record<string, unknown>>;
      assert.equal(events[0]!.__className__, 'SpanEventDto');
      assert.equal(events[0]!.name, 'lcp');
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
      const transport = new ServerpodTransport({
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
