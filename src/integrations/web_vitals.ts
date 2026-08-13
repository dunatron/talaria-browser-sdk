import type { Teardown } from '../replay/hooks.js';

export type WebVitalName = 'lcp' | 'inp' | 'cls';

export interface WebVital {
  name: WebVitalName;
  value: number;
  at: Date;
}

type LayoutShiftLike = PerformanceEntry & {
  value?: number;
  hadRecentInput?: boolean;
};

type EventTimingLike = PerformanceEntry & {
  duration: number;
};

/**
 * Lightweight Web Vitals via PerformanceObserver (no `web-vitals` dependency).
 * Reports `lcp`, `inp`, and `cls` as they update.
 */
export function installWebVitals(onVital: (vital: WebVital) => void): Teardown {
  if (typeof PerformanceObserver === 'undefined') {
    return () => {};
  }

  const observers: PerformanceObserver[] = [];
  const supported = (type: string): boolean => {
    try {
      const types = PerformanceObserver.supportedEntryTypes;
      if (!types) return true;
      return Array.from(types).includes(type);
    } catch {
      return true;
    }
  };

  const observe = (
    type: string,
    callback: PerformanceObserverCallback,
    extra?: Record<string, unknown>,
  ): boolean => {
    if (!supported(type)) return false;
    try {
      const po = new PerformanceObserver(callback);
      po.observe({ type, buffered: true, ...extra } as PerformanceObserverInit);
      observers.push(po);
      return true;
    } catch {
      return false;
    }
  };

  observe('largest-contentful-paint', (list) => {
    const entries = list.getEntries();
    const last = entries[entries.length - 1];
    if (!last) return;
    onVital({ name: 'lcp', value: last.startTime, at: new Date() });
  });

  let inp = 0;
  const onEventTiming: PerformanceObserverCallback = (list) => {
    for (const entry of list.getEntries() as EventTimingLike[]) {
      const duration = entry.duration;
      if (typeof duration !== 'number' || duration <= inp) continue;
      inp = duration;
      onVital({ name: 'inp', value: inp, at: new Date() });
    }
  };
  if (!observe('event', onEventTiming, { durationThreshold: 16 })) {
    observe('first-input', onEventTiming);
  }

  let cls = 0;
  observe('layout-shift', (list) => {
    for (const entry of list.getEntries() as LayoutShiftLike[]) {
      if (entry.hadRecentInput) continue;
      const value = typeof entry.value === 'number' ? entry.value : 0;
      cls += value;
      onVital({ name: 'cls', value: cls, at: new Date() });
    }
  });

  return () => {
    for (const po of observers) {
      try {
        po.disconnect();
      } catch {
        // ignore
      }
    }
    observers.length = 0;
  };
}
