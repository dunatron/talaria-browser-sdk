import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_TRACES_SAMPLE_RATE,
  headSample,
  isTracingEnabled,
  resolveTracesSampleRate,
  shouldKeepTransaction,
} from '../src/tracing/sampling.ts';

describe('tracing sampling', () => {
  it('stays off until enableTracing or tracesSampleRate > 0', () => {
    assert.equal(isTracingEnabled({}), false);
    assert.equal(isTracingEnabled({ tracesSampleRate: 0 }), false);
    assert.equal(isTracingEnabled({ enableTracing: true }), true);
    assert.equal(isTracingEnabled({ tracesSampleRate: 0.1 }), true);
    assert.equal(
      isTracingEnabled({ enableTracing: false, tracesSampleRate: 1 }),
      false,
    );
  });

  it('defaults successful rate to 10% when tracing is on', () => {
    assert.equal(resolveTracesSampleRate({}), 0);
    assert.equal(
      resolveTracesSampleRate({ enableTracing: true }),
      DEFAULT_TRACES_SAMPLE_RATE,
    );
    assert.equal(resolveTracesSampleRate({ tracesSampleRate: 0.5 }), 0.5);
    assert.equal(
      resolveTracesSampleRate({ enableTracing: true, tracesSampleRate: 0 }),
      0,
    );
  });

  it('keeps error transactions even when the head sample missed', () => {
    assert.equal(shouldKeepTransaction(false, false), false);
    assert.equal(shouldKeepTransaction(true, false), true);
    assert.equal(shouldKeepTransaction(false, true), true);
    assert.equal(headSample(0), false);
    assert.equal(headSample(1), true);
  });
});
