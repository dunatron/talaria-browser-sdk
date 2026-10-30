import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { gzipSync } from 'node:zlib';
import { IngestTransport } from '../src/transport/http_transport.ts';
import {
  finishReplay,
  ingestReplaySegment,
  startReplay,
} from '../src/transport/replays.ts';

describe('POST /v1/replays transport', () => {
  it('start, segment batch, and finish use REST paths and base64 gzipBytes', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
      });
      return new Response('{}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      const transport = new IngestTransport({
        baseUrl: 'https://ingest-nz1.newtalaria.com',
        apiKey: 'tal_pk_test',
      });
      const replayId = '11111111-1111-4111-8111-111111111111';
      await startReplay(transport, {
        replayId,
        environment: 'development',
        sessionId: 'sess-1',
        url: 'https://app.example/',
        userId: 'user-1',
        userAgent: 'test-agent',
      });

      const gzip = gzipSync(Buffer.from(JSON.stringify([{ type: 2, data: {} }])));
      await ingestReplaySegment(transport, {
        replayId,
        segmentIndex: 0,
        events: [{ type: 2, data: {} }],
        startedAt: new Date('2026-01-01T00:00:00.000Z'),
        endedAt: new Date('2026-01-01T00:00:01.000Z'),
        gzip: new Uint8Array(gzip),
      });

      await finishReplay(transport, { replayId, reason: 'pagehide' });

      assert.equal(calls.length, 3);
      assert.equal(calls[0]!.url, 'https://ingest-nz1.newtalaria.com/v1/replays');
      assert.equal(calls[0]!.body.replayId, replayId);
      assert.equal(calls[0]!.body.sessionId, 'sess-1');
      assert.equal(calls[0]!.body.environment, undefined);

      assert.equal(
        calls[1]!.url,
        'https://ingest-nz1.newtalaria.com/v1/replays/segments',
      );
      const segments = calls[1]!.body.segments as Array<Record<string, unknown>>;
      assert.equal(segments.length, 1);
      assert.equal(segments[0]!.replayId, replayId);
      assert.equal(segments[0]!.segmentIndex, 0);
      assert.equal(segments[0]!.eventCount, 1);
      assert.equal(typeof segments[0]!.gzipBytes, 'string');
      assert.equal(String(segments[0]!.gzipBytes).includes('decode('), false);
      assert.equal(
        segments[0]!.gzipBytes,
        Buffer.from(gzip).toString('base64'),
      );

      assert.equal(
        calls[2]!.url,
        `https://ingest-nz1.newtalaria.com/v1/replays/${encodeURIComponent(replayId)}/finish`,
      );
      assert.equal(calls[2]!.body.reason, 'pagehide');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
