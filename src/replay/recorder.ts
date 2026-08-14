import { record } from 'rrweb';
import { defaultBlockSelector } from './privacy.js';
import type { RrwebEvent } from './segment_buffer.js';

export interface RecorderOptions {
  maskAllInputs: boolean;
  /** Embed accessible stylesheet rules into the snapshot. Default false at resolve time. */
  inlineStylesheet: boolean;
  blockSelector?: string;
  /**
   * Periodic Meta+FullSnapshot while recording (rrweb `checkoutEveryNms`).
   * Set in buffer/error-sample mode so the ring never ages out its paint base.
   */
  checkoutEveryNms?: number;
  onEvent: (event: RrwebEvent) => void;
}

export interface RecorderHandle {
  stop: () => void;
  /** Force Meta + FullSnapshot so the next replay has a paint base. */
  takeFullSnapshot: () => void;
}

export function startRecorder(options: RecorderOptions): RecorderHandle {
  if (typeof document === 'undefined') {
    return {
      stop: () => {},
      takeFullSnapshot: () => {},
    };
  }

  let stopFn: ReturnType<typeof record> | undefined;
  try {
    stopFn = record({
      emit(event) {
        try {
          options.onEvent(event as RrwebEvent);
        } catch {
          // Snapshot/emit must not become a user-facing error.
        }
      },
      maskAllInputs: options.maskAllInputs,
      maskInputOptions: {
        password: true,
      },
      blockSelector: defaultBlockSelector(options.blockSelector),
      recordCanvas: false,
      collectFonts: false,
      inlineStylesheet: options.inlineStylesheet,
      // Shrink DOM snapshots on heavy sites (docs / marketing).
      slimDOMOptions: 'all',
      ...(options.checkoutEveryNms != null && options.checkoutEveryNms > 0
        ? { checkoutEveryNms: options.checkoutEveryNms }
        : {}),
      sampling: {
        mousemove: 150,
        scroll: 200,
        input: 'last',
      },
    });
  } catch {
    return {
      stop: () => {},
      takeFullSnapshot: () => {},
    };
  }

  return {
    stop: () => {
      stopFn?.();
    },
    takeFullSnapshot: () => {
      try {
        // isCheckout=true resets incremental baseline against the new snapshot.
        record.takeFullSnapshot(true);
      } catch {
        // ignore
      }
    },
  };
}
