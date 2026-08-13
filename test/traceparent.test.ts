import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  extractTraceparent,
  formatTraceparent,
  parseTraceparent,
} from '../src/tracing/traceparent.ts';

describe('W3C traceparent', () => {
  it('formats and parses a sampled header', () => {
    const header = formatTraceparent({
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      spanId: '00f067aa0ba902b7',
      sampled: true,
    });
    assert.equal(
      header,
      '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
    );
    const parsed = parseTraceparent(header);
    assert.ok(parsed);
    assert.equal(parsed!.traceId, '4bf92f3577b34da6a3ce929d0e0e4736');
    assert.equal(parsed!.spanId, '00f067aa0ba902b7');
    assert.equal(parsed!.sampled, true);
  });

  it('rejects all-zero ids and malformed headers', () => {
    assert.equal(
      parseTraceparent(
        '00-00000000000000000000000000000000-00f067aa0ba902b7-01',
      ),
      null,
    );
    assert.equal(parseTraceparent('not-a-header'), null);
    assert.equal(parseTraceparent(''), null);
  });

  it('extracts from Headers', () => {
    const headers = new Headers({
      traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-00',
    });
    const parsed = extractTraceparent(headers);
    assert.equal(parsed?.sampled, false);
    assert.equal(parsed?.spanId, '00f067aa0ba902b7');
  });
});
