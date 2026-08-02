import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { installVisibilityResumeHook } from '../src/replay/hooks.ts';

describe('installVisibilityResumeHook', () => {
  it('invokes onResume when the tab becomes visible', () => {
    const listeners = new Map<string, EventListener>();
    const fakeDocument = {
      visibilityState: 'hidden' as DocumentVisibilityState,
      addEventListener(type: string, listener: EventListener) {
        listeners.set(type, listener);
      },
      removeEventListener(type: string, listener: EventListener) {
        if (listeners.get(type) === listener) listeners.delete(type);
      },
    };

    const previous = globalThis.document;
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: fakeDocument,
    });

    try {
      let calls = 0;
      const teardown = installVisibilityResumeHook(() => {
        calls += 1;
      });

      assert.ok(listeners.has('visibilitychange'));
      fakeDocument.visibilityState = 'visible';
      listeners.get('visibilitychange')!(new Event('visibilitychange'));
      assert.equal(calls, 1);

      fakeDocument.visibilityState = 'hidden';
      listeners.get('visibilitychange')!(new Event('visibilitychange'));
      assert.equal(calls, 1);

      teardown();
      assert.equal(listeners.has('visibilitychange'), false);
    } finally {
      Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: previous,
      });
    }
  });

  it('invokes onResume only for bfcache pageshow (persisted)', () => {
    const docListeners = new Map<string, EventListener>();
    const winListeners = new Map<string, EventListener>();
    const fakeDocument = {
      visibilityState: 'visible' as DocumentVisibilityState,
      addEventListener(type: string, listener: EventListener) {
        docListeners.set(type, listener);
      },
      removeEventListener(type: string, listener: EventListener) {
        if (docListeners.get(type) === listener) docListeners.delete(type);
      },
    };
    const fakeWindow = {
      addEventListener(type: string, listener: EventListener) {
        winListeners.set(type, listener);
      },
      removeEventListener(type: string, listener: EventListener) {
        if (winListeners.get(type) === listener) winListeners.delete(type);
      },
    };

    const prevDoc = globalThis.document;
    const prevWin = globalThis.window;
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: fakeDocument,
    });
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: fakeWindow,
    });

    try {
      let calls = 0;
      const teardown = installVisibilityResumeHook(() => {
        calls += 1;
      });

      winListeners.get('pageshow')!(
        new Event('pageshow') as PageTransitionEvent,
      );
      assert.equal(calls, 0);

      const persisted = new Event('pageshow') as PageTransitionEvent;
      Object.defineProperty(persisted, 'persisted', { value: true });
      winListeners.get('pageshow')!(persisted);
      assert.equal(calls, 1);

      teardown();
      assert.equal(winListeners.has('pageshow'), false);
    } finally {
      Object.defineProperty(globalThis, 'document', {
        configurable: true,
        value: prevDoc,
      });
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: prevWin,
      });
    }
  });
});
