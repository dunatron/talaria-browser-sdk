import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { installWebVitals } from '../src/integrations/web_vitals.ts';

describe('web vitals observer', () => {
  it('no-ops when PerformanceObserver is missing', () => {
    const original = globalThis.PerformanceObserver;
    // @ts-expect-error test double
    globalThis.PerformanceObserver = undefined;
    try {
      const seen: string[] = [];
      const stop = installWebVitals((v) => seen.push(v.name));
      stop();
      assert.deepEqual(seen, []);
    } finally {
      globalThis.PerformanceObserver = original;
    }
  });

  it('forwards lcp/inp/cls entries from PerformanceObserver', () => {
    const observers: FakeObserver[] = [];

    class FakeObserver {
      cb: PerformanceObserverCallback;
      type: string | null = null;
      constructor(cb: PerformanceObserverCallback) {
        this.cb = cb;
        observers.push(this);
      }
      observe(opts: { type: string }): void {
        this.type = opts.type;
      }
      disconnect(): void {}
      static supportedEntryTypes = [
        'largest-contentful-paint',
        'event',
        'layout-shift',
      ];
    }

    const original = globalThis.PerformanceObserver;
    globalThis.PerformanceObserver = FakeObserver as unknown as typeof PerformanceObserver;
    try {
      const seen: Array<{ name: string; value: number }> = [];
      const stop = installWebVitals((v) =>
        seen.push({ name: v.name, value: v.value }),
      );

      const lcp = observers.find((o) => o.type === 'largest-contentful-paint');
      const inp = observers.find((o) => o.type === 'event');
      const cls = observers.find((o) => o.type === 'layout-shift');
      assert.ok(lcp && inp && cls);

      lcp!.cb(
        {
          getEntries: () => [{ startTime: 1234 } as PerformanceEntry],
        } as PerformanceObserverEntryList,
        lcp as unknown as PerformanceObserver,
      );
      inp!.cb(
        {
          getEntries: () => [{ duration: 80 } as PerformanceEntry],
        } as PerformanceObserverEntryList,
        inp as unknown as PerformanceObserver,
      );
      cls!.cb(
        {
          getEntries: () =>
            [{ value: 0.05, hadRecentInput: false } as PerformanceEntry],
        } as PerformanceObserverEntryList,
        cls as unknown as PerformanceObserver,
      );

      stop();
      assert.deepEqual(seen, [
        { name: 'lcp', value: 1234 },
        { name: 'inp', value: 80 },
        { name: 'cls', value: 0.05 },
      ]);
    } finally {
      globalThis.PerformanceObserver = original;
    }
  });
});
