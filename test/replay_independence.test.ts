import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TalariaClient } from '../src/client.ts';
import { DEFAULT_IGNORE_ERRORS, shouldDropCapturedError } from '../src/utils/event_filters.js';

describe('replay independence', () => {
  it('drops Autofill before ingest and does not start an error-clip', async () => {
    const calls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      const client = new TalariaClient();
      client.init({
        dsn: 'http://localhost:8080',
        apiKey: 'tal_live_test',
        environment: 'development',
        replaysSessionSampleRate: 1,
        replaysOnErrorSampleRate: 1,
        disableDefaultIntegrations: true,
      });

      await client.captureException(
        new Error("Can't find variable: _AutofillCallbackHandler"),
      );

      assert.equal(
        shouldDropCapturedError({
          message: "Can't find variable: _AutofillCallbackHandler",
          ignoreErrors: DEFAULT_IGNORE_ERRORS,
          ignoreUrls: [],
        }),
        true,
      );
      assert.equal(
        calls.some((url) => url.includes('events/ingest')),
        false,
      );
      // Session recording is independent of error filters. A sampled session
      // still has a replay id; dropped Autofill must not start an error-clip
      // (no events/ingest, and capture() never arms the clip path).
      assert.ok(client.getReplayId());

      await client.close();
      assert.equal(
        calls.some((url) => url.includes('events/ingest')),
        false,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
