import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TalariaClient } from '../src/client.ts';
import type { BeforeSendEvent } from '../src/types.ts';

type IngestBody = {
  input?: Record<string, unknown>;
};

function installFetchCapture(): {
  bodies: IngestBody[];
  restore: () => void;
} {
  const bodies: IngestBody[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(_input);
    if (url.includes('/events/')) {
      bodies.push(JSON.parse(String(init?.body ?? '{}')) as IngestBody);
    }
    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return {
    bodies,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

function initClient(
  overrides: Parameters<TalariaClient['init']>[0] = {} as never,
): TalariaClient {
  const client = new TalariaClient();
  client.init({
    dsn: 'http://localhost:8080',
    apiKey: 'tal_live_test',
    environment: 'development',
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    disableDefaultIntegrations: true,
    ...overrides,
  });
  return client;
}

describe('logger API', () => {
  it('level methods send the expected severity', async () => {
    const { bodies, restore } = installFetchCapture();
    try {
      const client = initClient();
      await client.info('hello-info');
      await client.warn('hello-warn');
      await client.error('hello-error');
      await client.close();

      const levels = bodies.map((b) => b.input?.level);
      assert.deepEqual(levels, ['info', 'warning', 'error']);
    } finally {
      restore();
    }
  });

  it('minLevel drops lower severities and keeps higher', async () => {
    const { bodies, restore } = installFetchCapture();
    try {
      const client = initClient({ minLevel: 'warning' });
      await client.debug('d');
      await client.info('i');
      await client.warning('w');
      await client.error('e');
      await client.close();

      const messages = bodies.map((b) => b.input?.message);
      assert.deepEqual(messages, ['w', 'e']);
    } finally {
      restore();
    }
  });

  it('sampleRate 0 drops all events after minLevel', async () => {
    const { bodies, restore } = installFetchCapture();
    try {
      const client = initClient({ sampleRate: 0 });
      await client.fatal('should-not-send');
      await client.captureException(new Error('nope'));
      await client.close();
      assert.equal(bodies.length, 0);
    } finally {
      restore();
    }
  });

  it('beforeSend can drop or mutate events', async () => {
    const { bodies, restore } = installFetchCapture();
    try {
      const client = initClient({
        beforeSend(event: BeforeSendEvent) {
          if (event.message === 'drop-me') return null;
          return { ...event, message: `mutated:${event.message}` };
        },
      });
      await client.info('drop-me');
      await client.info('keep-me');
      await client.close();

      assert.equal(bodies.length, 1);
      assert.equal(bodies[0]!.input?.message, 'mutated:keep-me');
    } finally {
      restore();
    }
  });

  it('beforeSend is not called when minLevel filters', async () => {
    let called = 0;
    const { bodies, restore } = installFetchCapture();
    try {
      const client = initClient({
        minLevel: 'error',
        beforeSend(event) {
          called += 1;
          return event;
        },
      });
      await client.info('filtered');
      await client.error('sent');
      await client.close();

      assert.equal(called, 1);
      assert.equal(bodies.length, 1);
      assert.equal(bodies[0]!.input?.message, 'sent');
    } finally {
      restore();
    }
  });

  it('scoped child inherits and can override minLevel', async () => {
    const { bodies, restore } = installFetchCapture();
    try {
      const client = initClient({ minLevel: 'warning' });
      const logger = client.logger({ tags: { feature: 'blog' } });
      assert.equal(logger.getMinLevel(), 'warning');
      assert.equal(logger.isLevelEnabled('info'), false);
      assert.equal(logger.isLevelEnabled('warning'), true);

      const raised = logger.child({ minLevel: 'error' });
      assert.equal(raised.getMinLevel(), 'error');
      assert.equal(raised.isLevelEnabled('warning'), false);

      // Assign replaces parent — child may lower after a raise.
      const weakened = raised.child({ minLevel: 'debug' });
      assert.equal(weakened.getMinLevel(), 'debug');

      await logger.info('nope');
      await logger.warning('warn-ok');
      await raised.warning('nope2');
      await raised.error('err-ok', { tags: { component: 'x' } });
      await weakened.info('info-from-weakened');
      await client.close();

      const messages = bodies.map((b) => b.input?.message);
      assert.deepEqual(messages, ['warn-ok', 'err-ok', 'info-from-weakened']);

      const errTags = bodies[1]!.input?.tags as Record<string, string>;
      assert.equal(errTags.feature, 'blog');
      assert.equal(errTags.component, 'x');
    } finally {
      restore();
    }
  });

  it('scoped logger can lower below client default', async () => {
    const { bodies, restore } = installFetchCapture();
    try {
      const client = initClient({
        minLevel: 'warning',
        enforceDefaultLevel: false,
      });
      const verbose = client.logger({
        minLevel: 'info',
        tags: { area: 'businessDirectory' },
      });
      assert.equal(verbose.getMinLevel(), 'info');
      assert.equal(verbose.isLevelEnabled('info'), true);

      await verbose.info('bd-info');
      await client.info('direct-dropped');
      await client.close();

      const messages = bodies.map((b) => b.input?.message);
      assert.deepEqual(messages, ['bd-info']);
      const tags = bodies[0]!.input?.tags as Record<string, string>;
      assert.equal(tags.area, 'businessDirectory');
    } finally {
      restore();
    }
  });

  it('enforceDefaultLevel restores hard floor', async () => {
    const { bodies, restore } = installFetchCapture();
    try {
      const client = initClient({
        minLevel: 'warning',
        enforceDefaultLevel: true,
      });
      const verbose = client.logger({ minLevel: 'info' });
      assert.equal(verbose.getMinLevel(), 'warning');
      assert.equal(verbose.isLevelEnabled('info'), false);

      await verbose.info('dropped');
      await verbose.warning('kept');
      await client.close();

      assert.deepEqual(
        bodies.map((b) => b.input?.message),
        ['kept'],
      );
    } finally {
      restore();
    }
  });

  it('named logger presets', async () => {
    const { bodies, restore } = installFetchCapture();
    try {
      const client = initClient({
        minLevel: 'warning',
        loggers: {
          businessDirectory: {
            minLevel: 'info',
            tags: { area: 'businessDirectory' },
          },
        },
      });

      const byName = client.logger('businessDirectory');
      assert.equal(byName.getMinLevel(), 'info');

      const merged = client.logger({
        name: 'businessDirectory',
        tags: { request: 'x' },
      });
      await merged.info('named-info');
      await client.close();

      assert.equal(bodies.length, 1);
      assert.equal(bodies[0]!.input?.message, 'named-info');
      const tags = bodies[0]!.input?.tags as Record<string, string>;
      assert.equal(tags.area, 'businessDirectory');
      assert.equal(tags.request, 'x');
    } finally {
      restore();
    }
  });

  it('setMinLevel updates the global floor at runtime', async () => {
    const { bodies, restore } = installFetchCapture();
    try {
      const client = initClient({ minLevel: 'debug' });
      client.setMinLevel('error');
      assert.equal(client.getMinLevel(), 'error');
      await client.warning('dropped');
      await client.error('kept');
      await client.close();
      assert.deepEqual(
        bodies.map((b) => b.input?.message),
        ['kept'],
      );
    } finally {
      restore();
    }
  });

  it('captureException respects minLevel fatal', async () => {
    const { bodies, restore } = installFetchCapture();
    try {
      const client = initClient({ minLevel: 'fatal' });
      await client.captureException(new Error('dropped-as-error'));
      await client.fatal('kept-fatal');
      await client.close();
      assert.equal(bodies.length, 1);
      assert.equal(bodies[0]!.input?.message, 'kept-fatal');
    } finally {
      restore();
    }
  });
});
