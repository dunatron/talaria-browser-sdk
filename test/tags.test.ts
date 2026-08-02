import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  HIGH_CARDINALITY_TAG_KEYS,
  looksHighCardinalityValue,
  mergeTags,
  normalizeTags,
} from '../src/utils/tags.js';

describe('normalizeTags', () => {
  it('lowercases keys and trims', () => {
    assert.deepEqual(normalizeTags({ Feature: ' Checkout ' }), {
      feature: 'Checkout',
    });
  });

  it('drops invalid keys', () => {
    assert.deepEqual(
      normalizeTags({
        ok: '1',
        'Bad Key!': 'x',
        '': 'y',
      }),
      { ok: '1' },
    );
  });

  it('allows dotted keys', () => {
    assert.deepEqual(normalizeTags({ 'browser.name': 'Chrome' }), {
      'browser.name': 'Chrome',
    });
  });

  it('caps tag count at 20', () => {
    const input: Record<string, string> = {};
    for (let i = 0; i < 25; i++) input[`k${i}`] = `v${i}`;
    assert.equal(Object.keys(normalizeTags(input)).length, 20);
  });

  it('mergeTags: later wins', () => {
    assert.deepEqual(
      mergeTags({ feature: 'a', service: 'web' }, { feature: 'b' }),
      { feature: 'b', service: 'web' },
    );
  });
});

describe('high cardinality heuristics', () => {
  it('flags denylist keys', () => {
    assert.ok(HIGH_CARDINALITY_TAG_KEYS.has('request_id'));
    assert.ok(HIGH_CARDINALITY_TAG_KEYS.has('user_id'));
  });

  it('detects uuid/email/long numeric values', () => {
    assert.ok(
      looksHighCardinalityValue('550e8400-e29b-41d4-a716-446655440000'),
    );
    assert.ok(looksHighCardinalityValue('a@b.co'));
    assert.ok(looksHighCardinalityValue('12345678'));
    assert.equal(looksHighCardinalityValue('checkout'), false);
  });
});
