import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createSpanId, createTraceId, isSpanId, isTraceId } from '../src/tracing/ids.ts';

describe('trace/span ids', () => {
  it('creates 32-hex trace ids and 16-hex span ids', () => {
    const traceId = createTraceId();
    const spanId = createSpanId();
    assert.equal(traceId.length, 32);
    assert.equal(spanId.length, 16);
    assert.equal(isTraceId(traceId), true);
    assert.equal(isSpanId(spanId), true);
    assert.equal(/^0+$/.test(traceId), false);
    assert.equal(/^0+$/.test(spanId), false);
  });
});
