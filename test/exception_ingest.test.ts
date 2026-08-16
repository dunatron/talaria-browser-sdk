import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TalariaClient } from '../src/client.ts';

describe('captureException exception payload', () => {
  it('sends first-class exception + platform on ingest', async () => {
    let body: Record<string, unknown> | null = null;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
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
        replaysSessionSampleRate: 0,
        replaysOnErrorSampleRate: 0,
        disableDefaultIntegrations: true,
      });

      const err = new Error('something broke');
      err.name = 'TypeError';
      err.stack = `TypeError: something broke
    at crash (http://app.example.com/app.js:10:5)
    at run (http://app.example.com/app.js:2:1)`;

      await client.captureException(err);
      await client.close();

      assert.ok(body);
      const input = body!.input as Record<string, unknown>;
      assert.equal(input.platform, 'javascript');
      assert.equal(typeof input.stackTrace, 'string');
      assert.ok(input.exception);

      const exception = input.exception as {
        __className__: string;
        values: Array<Record<string, unknown>>;
      };
      assert.equal(exception.__className__, 'ExceptionDataDto');
      assert.equal(exception.values.length, 1);
      assert.equal(exception.values[0]!.type, 'TypeError');
      assert.equal(exception.values[0]!.value, 'something broke');
      assert.equal(
        (exception.values[0]!.mechanism as { type: string }).type,
        'generic',
      );

      const stacktrace = exception.values[0]!.stacktrace as {
        frames: Array<{ functionName?: string; lineno?: number }>;
      };
      assert.equal(stacktrace.frames.length, 2);
      // oldest → newest
      assert.equal(stacktrace.frames[0]!.functionName, 'run');
      assert.equal(stacktrace.frames[1]!.functionName, 'crash');
      assert.equal(stacktrace.frames[1]!.lineno, 10);

      // No exception_class / file / line in extra
      const extra = JSON.parse(String(input.extraJson ?? '{}')) as Record<
        string,
        unknown
      >;
      assert.equal(extra.exception_class, undefined);
      assert.equal(extra.file, undefined);
      assert.equal(extra.line, undefined);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('scrubs legacy exception_class / file / line / code from extra', async () => {
    let body: Record<string, unknown> | null = null;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
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
        replaysSessionSampleRate: 0,
        replaysOnErrorSampleRate: 0,
        disableDefaultIntegrations: true,
      });

      await client.captureException(new Error('legacy'), {
        extra: {
          exception_class: 'ShouldNotAppear',
          file: 'x.js',
          line: 1,
          code: 'E',
          keep_me: true,
        },
      });
      await client.close();

      const input = body!.input as Record<string, unknown>;
      const extra = JSON.parse(String(input.extraJson ?? '{}')) as Record<
        string,
        unknown
      >;
      assert.equal(extra.exception_class, undefined);
      assert.equal(extra.file, undefined);
      assert.equal(extra.line, undefined);
      assert.equal(extra.code, undefined);
      assert.equal(extra.keep_me, true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('marks unhandledrejection as handled: false', async () => {
    let body: Record<string, unknown> | null = null;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
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
        replaysSessionSampleRate: 0,
        replaysOnErrorSampleRate: 0,
        disableDefaultIntegrations: true,
      });

      const err = new Error('boom');
      await client.captureException(err, {
        mechanism: { type: 'unhandledrejection', handled: false },
      });
      await client.close();

      const input = body!.input as Record<string, unknown>;
      assert.equal(input.platform, 'javascript');
      const exception = input.exception as {
        values: Array<{ mechanism?: { type?: string; handled?: boolean } }>;
      };
      assert.equal(exception.values[0]!.mechanism?.type, 'unhandledrejection');
      assert.equal(exception.values[0]!.mechanism?.handled, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('sets platform javascript on captureMessage', async () => {
    let body: Record<string, unknown> | null = null;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
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
        replaysSessionSampleRate: 0,
        replaysOnErrorSampleRate: 0,
        disableDefaultIntegrations: true,
      });

      await client.captureMessage('hello from logger');
      await client.close();

      const input = body!.input as Record<string, unknown>;
      assert.equal(input.platform, 'javascript');
      assert.equal(input.message, 'hello from logger');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
