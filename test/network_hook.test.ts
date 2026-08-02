import assert from 'node:assert/strict';
import { describe, it, before, after } from 'node:test';
import {
  classifyNetworkParty,
  enrichNetworkMeta,
  installNetworkHook,
  isAllowedNetworkOrigin,
  isHttpOkStatus,
  shouldPromoteFailedRequest,
  shouldPromoteNetworkError,
  type NetworkMeta,
} from '../src/replay/hooks.ts';

const PAGE = 'https://app.example.com';

/** Minimal XHR stand-in so Node can exercise the prototype patches. */
class FakeXMLHttpRequest {
  static UNSENT = 0;
  static OPENED = 1;
  static DONE = 4;

  status = 0;
  readyState = FakeXMLHttpRequest.UNSENT;
  responseText = '';
  private listeners = new Map<string, Array<{ fn: EventListener; once: boolean }>>();

  open(_method: string, _url: string | URL, _async?: boolean): void {
    this.readyState = FakeXMLHttpRequest.OPENED;
  }

  send(_body?: Document | XMLHttpRequestBodyInit | null): void {
    // Tests complete the request via `complete()`.
  }

  abort(): void {
    this.status = 0;
    this.dispatchEvent(new Event('abort'));
  }

  addEventListener(
    type: string,
    fn: EventListener,
    options?: boolean | AddEventListenerOptions,
  ): void {
    const once =
      typeof options === 'object' && options !== null ? !!options.once : false;
    const list = this.listeners.get(type) ?? [];
    list.push({ fn, once });
    this.listeners.set(type, list);
  }

  removeEventListener(type: string, fn: EventListener): void {
    const list = this.listeners.get(type);
    if (!list) return;
    this.listeners.set(
      type,
      list.filter((entry) => entry.fn !== fn),
    );
  }

  dispatchEvent(event: Event): boolean {
    const list = [...(this.listeners.get(event.type) ?? [])];
    for (const entry of list) {
      entry.fn.call(this, event);
      if (entry.once) {
        this.removeEventListener(event.type, entry.fn);
      }
    }
    return true;
  }

  /** Finish the request with a status (and optional prior timeout/abort events). */
  complete(
    status: number,
    opts?: { timeout?: boolean; abort?: boolean },
  ): void {
    if (opts?.timeout) this.dispatchEvent(new Event('timeout'));
    if (opts?.abort) this.dispatchEvent(new Event('abort'));
    this.status = status;
    this.readyState = FakeXMLHttpRequest.DONE;
    this.dispatchEvent(new Event('loadend'));
  }
}

const previousXHR = globalThis.XMLHttpRequest;

before(() => {
  // @ts-expect-error test double
  globalThis.XMLHttpRequest = FakeXMLHttpRequest;
});

after(() => {
  globalThis.XMLHttpRequest = previousXHR;
});

describe('isAllowedNetworkOrigin / classifyNetworkParty', () => {
  it('allows same-origin', () => {
    assert.equal(
      isAllowedNetworkOrigin('https://app.example.com', {
        networkErrorOrigins: [],
        pageOrigin: PAGE,
      }),
      true,
    );
    assert.equal(
      classifyNetworkParty('https://app.example.com', PAGE),
      'first_party',
    );
  });

  it('rejects third-party by default', () => {
    assert.equal(
      isAllowedNetworkOrigin('https://www.google-analytics.com', {
        networkErrorOrigins: [],
        pageOrigin: PAGE,
      }),
      false,
    );
    assert.equal(
      classifyNetworkParty('https://www.google-analytics.com', PAGE),
      'third_party',
    );
  });

  it('allows allowlisted third-party origins', () => {
    assert.equal(
      isAllowedNetworkOrigin('https://api.stripe.com', {
        networkErrorOrigins: ['https://api.stripe.com'],
        pageOrigin: PAGE,
      }),
      true,
    );
    assert.equal(
      classifyNetworkParty('https://api.stripe.com', PAGE),
      'third_party',
    );
  });

  it('allows all origins with *', () => {
    assert.equal(
      isAllowedNetworkOrigin('https://ct.pinterest.com', {
        networkErrorOrigins: ['*'],
        pageOrigin: PAGE,
      }),
      true,
    );
  });
});

describe('isHttpOkStatus', () => {
  it('treats only 2xx as ok (fetch/XHR aligned)', () => {
    assert.equal(isHttpOkStatus(200), true);
    assert.equal(isHttpOkStatus(299), true);
    assert.equal(isHttpOkStatus(301), false);
    assert.equal(isHttpOkStatus(404), false);
  });
});

describe('shouldPromoteFailedRequest', () => {
  const base = {
    captureFailedRequests: true,
    failedRequestStatusCodes: [[500, 599]] as Array<[number, number]>,
    failedRequestIgnoreUrls: [] as string[],
    networkErrorOrigins: [] as string[],
    pageOrigin: PAGE,
  };

  it('promotes matching first-party HTTP status', () => {
    assert.equal(
      shouldPromoteFailedRequest(
        {
          method: 'GET',
          url: 'https://app.example.com/api',
          origin: 'https://app.example.com',
          status: 500,
          ok: false,
        },
        base,
      ),
      true,
    );
  });

  it('does not promote third-party HTTP 500 by default', () => {
    assert.equal(
      shouldPromoteFailedRequest(
        {
          method: 'GET',
          url: 'https://cdn.example.net/x',
          origin: 'https://cdn.example.net',
          status: 500,
          ok: false,
        },
        base,
      ),
      false,
    );
  });

  it('promotes allowlisted third-party HTTP 500', () => {
    assert.equal(
      shouldPromoteFailedRequest(
        {
          method: 'GET',
          url: 'https://api.stripe.com/v1',
          origin: 'https://api.stripe.com',
          status: 500,
          ok: false,
        },
        { ...base, networkErrorOrigins: ['https://api.stripe.com'] },
      ),
      true,
    );
  });

  it('does not treat status 0 as an HTTP failure', () => {
    assert.equal(
      shouldPromoteFailedRequest(
        {
          method: 'GET',
          url: 'https://app.example.com/api',
          origin: 'https://app.example.com',
          status: 0,
          ok: false,
        },
        base,
      ),
      false,
    );
  });

  it('ignores Talaria ingest URLs', () => {
    assert.equal(
      shouldPromoteFailedRequest(
        {
          method: 'POST',
          url: 'https://api.example.com/events/ingest',
          origin: 'https://api.example.com',
          status: 500,
          ok: false,
        },
        {
          ...base,
          pageOrigin: 'https://api.example.com',
          talariaBaseUrl: 'https://api.example.com',
        },
      ),
      false,
    );
  });
});

describe('shouldPromoteNetworkError', () => {
  const base = {
    captureNetworkErrors: true,
    failedRequestIgnoreUrls: [] as string[],
    networkErrorOrigins: [] as string[],
    pageOrigin: PAGE,
  };

  it('promotes first-party network failureKind', () => {
    assert.equal(
      shouldPromoteNetworkError(
        {
          method: 'GET',
          url: 'https://app.example.com/settings',
          origin: 'https://app.example.com',
          ok: false,
          failureKind: 'network',
          errorName: 'TypeError',
          errorMessage: 'Failed to fetch',
        },
        base,
      ),
      true,
    );
  });

  it('does not promote third-party network failures by default', () => {
    assert.equal(
      shouldPromoteNetworkError(
        {
          method: 'POST',
          url: 'https://www.google-analytics.com/g/collect',
          origin: 'https://www.google-analytics.com',
          ok: false,
          failureKind: 'network',
          errorName: 'TypeError',
          errorMessage: 'Failed to fetch',
        },
        base,
      ),
      false,
    );
  });

  it('skips abort failures', () => {
    assert.equal(
      shouldPromoteNetworkError(
        {
          method: 'GET',
          url: 'https://app.example.com',
          origin: 'https://app.example.com',
          ok: false,
          failureKind: 'abort',
          aborted: true,
          errorName: 'AbortError',
          errorMessage: 'aborted',
        },
        base,
      ),
      false,
    );
  });

  it('allows first-party timeout failures', () => {
    assert.equal(
      shouldPromoteNetworkError(
        {
          method: 'GET',
          url: 'https://app.example.com',
          origin: 'https://app.example.com',
          ok: false,
          failureKind: 'timeout',
          errorName: 'TimeoutError',
          errorMessage: 'timed out',
        },
        base,
      ),
      true,
    );
  });

  it('does not promote third-party timeouts by default', () => {
    assert.equal(
      shouldPromoteNetworkError(
        {
          method: 'GET',
          url: 'https://widget.example.com/slow',
          origin: 'https://widget.example.com',
          ok: false,
          failureKind: 'timeout',
          errorName: 'TimeoutError',
          errorMessage: 'timed out',
        },
        base,
      ),
      false,
    );
  });

  it('respects captureNetworkErrors=false', () => {
    assert.equal(
      shouldPromoteNetworkError(
        {
          method: 'GET',
          url: 'https://app.example.com',
          origin: 'https://app.example.com',
          ok: false,
          failureKind: 'network',
        },
        { ...base, captureNetworkErrors: false },
      ),
      false,
    );
  });
});

describe('enrichNetworkMeta', () => {
  it('marks completed non-ok responses as http', () => {
    const meta = enrichNetworkMeta({
      method: 'GET',
      url: '/x',
      status: 502,
      ok: false,
    });
    assert.equal(meta.failureKind, 'http');
  });

  it('marks transport failures as network', () => {
    const meta = enrichNetworkMeta({
      method: 'GET',
      url: '/x',
      ok: false,
      errorName: 'TypeError',
      errorMessage: 'Failed to fetch',
    });
    assert.equal(meta.failureKind, 'network');
  });

  it('does not invent a failure for opaque status-0 success', () => {
    const meta = enrichNetworkMeta({
      method: 'GET',
      url: 'https://ads.example.com/pixel',
      status: 0,
      ok: true,
    });
    assert.equal(meta.failureKind, undefined);
  });
});

describe('installNetworkHook fetch wrapper', () => {
  it('preserves success response and args', async () => {
    const original = globalThis.fetch;
    const response = new Response('ok', { status: 200 });
    let seenInput: unknown;
    let seenInit: unknown;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seenInput = input;
      seenInit = init;
      return response;
    }) as typeof fetch;

    const metas: NetworkMeta[] = [];
    const teardown = installNetworkHook({
      captureFailedRequests: false,
      captureNetworkErrors: false,
      pageOrigin: PAGE,
      onNetwork: (m) => metas.push(m),
    });

    try {
      const init = { method: 'POST', headers: { 'X-Test': '1' } };
      const result = await fetch('https://app.example.com/api', init);
      assert.equal(result, response);
      assert.equal(seenInput, 'https://app.example.com/api');
      assert.deepEqual(seenInit, init);
      assert.equal(metas.length, 1);
      assert.equal(metas[0]!.status, 200);
      assert.equal(metas[0]!.method, 'POST');
      assert.equal(metas[0]!.ok, true);
      assert.equal(metas[0]!.party, 'first_party');
    } finally {
      teardown();
      globalThis.fetch = original;
    }
  });

  it('promotes first-party transport failure and records metadata', async () => {
    const original = globalThis.fetch;
    const failure = new TypeError('Failed to fetch');
    globalThis.fetch = (async () => {
      throw failure;
    }) as typeof fetch;

    const metas: NetworkMeta[] = [];
    const promoted: NetworkMeta[] = [];
    const teardown = installNetworkHook({
      captureFailedRequests: false,
      captureNetworkErrors: true,
      pageOrigin: PAGE,
      onNetwork: (m) => metas.push(m),
      onNetworkError: (m) => promoted.push(m),
    });

    try {
      await assert.rejects(
        () => fetch('https://app.example.com/settings'),
        (err: unknown) => err === failure,
      );
      assert.equal(metas.length, 1);
      assert.equal(metas[0]!.failureKind, 'network');
      assert.equal(metas[0]!.transport, 'fetch');
      assert.equal(metas[0]!.party, 'first_party');
      assert.equal(promoted.length, 1);
      assert.equal(promoted[0]!.url, 'https://app.example.com/settings');
    } finally {
      teardown();
      globalThis.fetch = original;
    }
  });

  it('does not promote third-party transport failures by default', async () => {
    const original = globalThis.fetch;
    const failure = new TypeError('Failed to fetch');
    globalThis.fetch = (async () => {
      throw failure;
    }) as typeof fetch;

    const metas: NetworkMeta[] = [];
    const promoted: NetworkMeta[] = [];
    const teardown = installNetworkHook({
      captureNetworkErrors: true,
      pageOrigin: PAGE,
      onNetwork: (m) => metas.push(m),
      onNetworkError: (m) => promoted.push(m),
    });

    try {
      await assert.rejects(() =>
        fetch('https://www.google-analytics.com/g/collect', { method: 'POST' }),
      );
      assert.equal(metas.length, 1);
      assert.equal(metas[0]!.party, 'third_party');
      assert.equal(metas[0]!.failureKind, 'network');
      assert.equal(promoted.length, 0);
    } finally {
      teardown();
      globalThis.fetch = original;
    }
  });

  it('promotes allowlisted third-party transport failures', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;

    const promoted: NetworkMeta[] = [];
    const teardown = installNetworkHook({
      captureNetworkErrors: true,
      pageOrigin: PAGE,
      networkErrorOrigins: ['https://widget.yonder.example'],
      onNetworkError: (m) => promoted.push(m),
    });

    try {
      await assert.rejects(() =>
        fetch('https://widget.yonder.example/settings'),
      );
      assert.equal(promoted.length, 1);
      assert.equal(promoted[0]!.party, 'third_party');
    } finally {
      teardown();
      globalThis.fetch = original;
    }
  });

  it('does not promote AbortError and classifies as abort', async () => {
    const original = globalThis.fetch;
    const failure = new Error('aborted');
    failure.name = 'AbortError';
    globalThis.fetch = (async () => {
      throw failure;
    }) as typeof fetch;

    const metas: NetworkMeta[] = [];
    const promoted: NetworkMeta[] = [];
    const teardown = installNetworkHook({
      captureNetworkErrors: true,
      pageOrigin: PAGE,
      networkErrorOrigins: ['*'],
      onNetwork: (m) => metas.push(m),
      onNetworkError: (m) => promoted.push(m),
    });

    try {
      await assert.rejects(() => fetch('https://example.com'), (err) => err === failure);
      assert.equal(promoted.length, 0);
      assert.equal(metas[0]!.failureKind, 'abort');
      assert.equal(metas[0]!.aborted, true);
      assert.equal(metas[0]!.transport, 'fetch');
    } finally {
      teardown();
      globalThis.fetch = original;
    }
  });

  it('passes Request objects through unchanged', async () => {
    const original = globalThis.fetch;
    let seenInput: unknown;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      seenInput = input;
      return new Response(null, { status: 204 });
    }) as typeof fetch;

    const teardown = installNetworkHook({
      captureFailedRequests: false,
      captureNetworkErrors: false,
      pageOrigin: PAGE,
    });

    try {
      const request = new Request('https://example.com/item', { method: 'PUT' });
      await fetch(request);
      assert.equal(seenInput, request);
    } finally {
      teardown();
      globalThis.fetch = original;
    }
  });

  it('keeps the original error if onNetworkError throws', async () => {
    const original = globalThis.fetch;
    const failure = new TypeError('Failed to fetch');
    globalThis.fetch = (async () => {
      throw failure;
    }) as typeof fetch;

    const teardown = installNetworkHook({
      captureNetworkErrors: true,
      pageOrigin: PAGE,
      onNetworkError: () => {
        throw new Error('instrumentation boom');
      },
    });

    try {
      await assert.rejects(
        () => fetch('https://app.example.com'),
        (err: unknown) => err === failure,
      );
    } finally {
      teardown();
      globalThis.fetch = original;
    }
  });

  it('strips query params and does not promote third-party GA failures', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;

    const metas: NetworkMeta[] = [];
    const promoted: NetworkMeta[] = [];
    const teardown = installNetworkHook({
      captureNetworkErrors: true,
      pageOrigin: PAGE,
      onNetwork: (m) => metas.push(m),
      onNetworkError: (m) => promoted.push(m),
    });

    try {
      await assert.rejects(() =>
        fetch(
          'https://www.google-analytics.com/g/collect?v=2&tid=G-NKDW3BEWF6&cid=1&sid=2&dl=https%3A%2F%2Fexample.com',
          { method: 'POST' },
        ),
      );
      assert.equal(promoted.length, 0);
      assert.equal(metas.length, 1);
      assert.equal(metas[0]!.method, 'POST');
      assert.equal(metas[0]!.url, 'https://www.google-analytics.com/g/collect');
      assert.equal(metas[0]!.hostname, 'www.google-analytics.com');
      assert.equal(metas[0]!.pathname, '/g/collect');
      assert.equal(metas[0]!.search, undefined);
      assert.equal(metas[0]!.failureKind, 'network');
      assert.equal(metas[0]!.party, 'third_party');
    } finally {
      teardown();
      globalThis.fetch = original;
    }
  });

  it('promotes first-party HTTP 500 with status and leaves query stripped', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response('nope', { status: 500 })) as typeof fetch;

    const httpFailures: NetworkMeta[] = [];
    const networkFailures: NetworkMeta[] = [];
    const teardown = installNetworkHook({
      captureFailedRequests: true,
      captureNetworkErrors: true,
      pageOrigin: PAGE,
      failedRequestStatusCodes: [[500, 599]],
      onFailedRequest: (m) => httpFailures.push(m),
      onNetworkError: (m) => networkFailures.push(m),
    });

    try {
      await fetch('https://app.example.com/boom?token=secret');
      assert.equal(httpFailures.length, 1);
      assert.equal(networkFailures.length, 0);
      assert.equal(httpFailures[0]!.status, 500);
      assert.equal(httpFailures[0]!.failureKind, 'http');
      assert.equal(httpFailures[0]!.url, 'https://app.example.com/boom');
      assert.equal(httpFailures[0]!.hostname, 'app.example.com');
      assert.equal(httpFailures[0]!.pathname, '/boom');
      assert.equal(httpFailures[0]!.party, 'first_party');
    } finally {
      teardown();
      globalThis.fetch = original;
    }
  });

  it('does not promote third-party HTTP 500 by default', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response('nope', { status: 500 })) as typeof fetch;

    const httpFailures: NetworkMeta[] = [];
    const teardown = installNetworkHook({
      captureFailedRequests: true,
      pageOrigin: PAGE,
      failedRequestStatusCodes: [[500, 599]],
      onFailedRequest: (m) => httpFailures.push(m),
    });

    try {
      await fetch('https://cdn.vendor.com/boom');
      assert.equal(httpFailures.length, 0);
    } finally {
      teardown();
      globalThis.fetch = original;
    }
  });

  it('does not promote HTTP 404 by default', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response('missing', { status: 404 })) as typeof fetch;

    const httpFailures: NetworkMeta[] = [];
    const teardown = installNetworkHook({
      captureFailedRequests: true,
      pageOrigin: PAGE,
      failedRequestStatusCodes: [[500, 599]],
      onFailedRequest: (m) => httpFailures.push(m),
    });

    try {
      const res = await fetch('https://app.example.com/missing');
      assert.equal(res.status, 404);
      assert.equal(httpFailures.length, 0);
    } finally {
      teardown();
      globalThis.fetch = original;
    }
  });

  it('does not promote Talaria ingest recursion', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;

    const promoted: NetworkMeta[] = [];
    const teardown = installNetworkHook({
      captureNetworkErrors: true,
      pageOrigin: 'https://api.example.com',
      talariaBaseUrl: 'https://api.example.com',
      networkErrorOrigins: ['*'],
      onNetworkError: (m) => promoted.push(m),
    });

    try {
      await assert.rejects(() =>
        fetch('https://api.example.com/events/ingest'),
      );
      assert.equal(promoted.length, 0);
    } finally {
      teardown();
      globalThis.fetch = original;
    }
  });

  it('classifies TimeoutError as timeout and may promote first-party', async () => {
    const original = globalThis.fetch;
    const failure = new Error('The operation was aborted due to timeout');
    failure.name = 'TimeoutError';
    globalThis.fetch = (async () => {
      throw failure;
    }) as typeof fetch;

    const promoted: NetworkMeta[] = [];
    const teardown = installNetworkHook({
      captureNetworkErrors: true,
      pageOrigin: PAGE,
      onNetworkError: (m) => promoted.push(m),
    });

    try {
      await assert.rejects(
        () => fetch('https://app.example.com/slow'),
        (err) => err === failure,
      );
      assert.equal(promoted.length, 1);
      assert.equal(promoted[0]!.failureKind, 'timeout');
      assert.equal(promoted[0]!.aborted, false);
      assert.equal(promoted[0]!.transport, 'fetch');
    } finally {
      teardown();
      globalThis.fetch = original;
    }
  });

  it('restores prior fetch on teardown', async () => {
    const original = globalThis.fetch;
    const stub = (async () => new Response('ok')) as typeof fetch;
    globalThis.fetch = stub;

    const teardown = installNetworkHook({
      captureFailedRequests: false,
      captureNetworkErrors: false,
      pageOrigin: PAGE,
    });
    const wrapped = globalThis.fetch;
    assert.notEqual(wrapped, stub);
    teardown();
    // installNetworkHook saves `fetch.bind(globalThis)`, so restore is that bound fn.
    assert.notEqual(globalThis.fetch, wrapped);
    const res = await globalThis.fetch('https://example.com');
    assert.equal(await res.text(), 'ok');
    globalThis.fetch = original;
  });

  it('forwards POST Request + RequestInit to native fetch', async () => {
    const original = globalThis.fetch;
    let seenInput: unknown;
    let seenInit: unknown;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seenInput = input;
      seenInit = init;
      return new Response(null, { status: 201 });
    }) as typeof fetch;

    const teardown = installNetworkHook({
      captureFailedRequests: false,
      captureNetworkErrors: false,
      pageOrigin: PAGE,
    });

    try {
      const request = new Request('https://example.com/create', { method: 'GET' });
      const init = { method: 'POST', body: '{"a":1}' };
      await fetch(request, init);
      assert.equal(seenInput, request);
      assert.deepEqual(seenInit, init);
    } finally {
      teardown();
      globalThis.fetch = original;
    }
  });
});

describe('installNetworkHook XHR wrapper', () => {
  it('records successful XHR without promoting', () => {
    const metas: NetworkMeta[] = [];
    const promoted: NetworkMeta[] = [];
    const teardown = installNetworkHook({
      captureFailedRequests: true,
      captureNetworkErrors: true,
      pageOrigin: PAGE,
      onNetwork: (m) => metas.push(m),
      onFailedRequest: (m) => promoted.push(m),
      onNetworkError: (m) => promoted.push(m),
    });

    try {
      const xhr = new FakeXMLHttpRequest();
      xhr.open('GET', 'https://app.example.com/ok');
      xhr.send();
      xhr.complete(200);
      assert.equal(metas.length, 1);
      assert.equal(metas[0]!.transport, 'xhr');
      assert.equal(metas[0]!.status, 200);
      assert.equal(metas[0]!.ok, true);
      assert.equal(metas[0]!.party, 'first_party');
      assert.equal(promoted.length, 0);
    } finally {
      teardown();
    }
  });

  it('does not stack loadend listeners on reused XHR', () => {
    const metas: NetworkMeta[] = [];
    const teardown = installNetworkHook({
      captureFailedRequests: false,
      captureNetworkErrors: false,
      pageOrigin: PAGE,
      onNetwork: (m) => metas.push(m),
    });

    try {
      const xhr = new FakeXMLHttpRequest();
      xhr.open('GET', 'https://app.example.com/a');
      xhr.send();
      xhr.complete(200);
      xhr.open('GET', 'https://app.example.com/b');
      xhr.send();
      xhr.complete(200);
      // With { once: true }, two sends → two metas (not 1+2=3).
      assert.equal(metas.length, 2);
    } finally {
      teardown();
    }
  });

  it('classifies XHR status 0 as network and promotes first-party', () => {
    const promoted: NetworkMeta[] = [];
    const teardown = installNetworkHook({
      captureNetworkErrors: true,
      pageOrigin: PAGE,
      onNetworkError: (m) => promoted.push(m),
    });

    try {
      const xhr = new FakeXMLHttpRequest();
      xhr.open('GET', 'https://app.example.com/fail');
      xhr.send();
      xhr.complete(0);
      assert.equal(promoted.length, 1);
      assert.equal(promoted[0]!.failureKind, 'network');
      assert.equal(promoted[0]!.transport, 'xhr');
      assert.equal(promoted[0]!.errorName, 'NetworkError');
    } finally {
      teardown();
    }
  });

  it('does not promote third-party XHR status 0', () => {
    const promoted: NetworkMeta[] = [];
    const metas: NetworkMeta[] = [];
    const teardown = installNetworkHook({
      captureNetworkErrors: true,
      pageOrigin: PAGE,
      onNetwork: (m) => metas.push(m),
      onNetworkError: (m) => promoted.push(m),
    });

    try {
      const xhr = new FakeXMLHttpRequest();
      xhr.open('GET', 'https://ct.pinterest.com/user/');
      xhr.send();
      xhr.complete(0);
      assert.equal(metas.length, 1);
      assert.equal(metas[0]!.party, 'third_party');
      assert.equal(promoted.length, 0);
    } finally {
      teardown();
    }
  });

  it('classifies XHR abort without promoting', () => {
    const metas: NetworkMeta[] = [];
    const promoted: NetworkMeta[] = [];
    const teardown = installNetworkHook({
      captureNetworkErrors: true,
      pageOrigin: PAGE,
      networkErrorOrigins: ['*'],
      onNetwork: (m) => metas.push(m),
      onNetworkError: (m) => promoted.push(m),
    });

    try {
      const xhr = new FakeXMLHttpRequest();
      xhr.open('GET', 'https://app.example.com/x');
      xhr.send();
      xhr.complete(0, { abort: true });
      assert.equal(metas.length, 1);
      assert.equal(metas[0]!.failureKind, 'abort');
      assert.equal(metas[0]!.aborted, true);
      assert.equal(promoted.length, 0);
    } finally {
      teardown();
    }
  });

  it('classifies XHR timeout and promotes first-party', () => {
    const promoted: NetworkMeta[] = [];
    const teardown = installNetworkHook({
      captureNetworkErrors: true,
      pageOrigin: PAGE,
      onNetworkError: (m) => promoted.push(m),
    });

    try {
      const xhr = new FakeXMLHttpRequest();
      xhr.open('GET', 'https://app.example.com/slow');
      xhr.send();
      xhr.complete(0, { timeout: true });
      assert.equal(promoted.length, 1);
      assert.equal(promoted[0]!.failureKind, 'timeout');
      assert.equal(promoted[0]!.errorName, 'TimeoutError');
    } finally {
      teardown();
    }
  });

  it('marks XHR 3xx as not ok (aligned with fetch)', () => {
    const metas: NetworkMeta[] = [];
    const teardown = installNetworkHook({
      captureFailedRequests: false,
      captureNetworkErrors: false,
      pageOrigin: PAGE,
      onNetwork: (m) => metas.push(m),
    });

    try {
      const xhr = new FakeXMLHttpRequest();
      xhr.open('GET', 'https://app.example.com/redirect');
      xhr.send();
      xhr.complete(302);
      assert.equal(metas.length, 1);
      assert.equal(metas[0]!.ok, false);
      assert.equal(metas[0]!.failureKind, 'http');
    } finally {
      teardown();
    }
  });
});
