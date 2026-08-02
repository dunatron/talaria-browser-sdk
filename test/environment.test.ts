import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeEnvironment } from '../src/utils/environment.ts';

describe('normalizeEnvironment', () => {
  it('accepts wire values', () => {
    assert.equal(normalizeEnvironment('production'), 'production');
    assert.equal(normalizeEnvironment('staging'), 'staging');
    assert.equal(normalizeEnvironment('development'), 'development');
  });

  it('maps aliases like PHP Environment::fromMixed', () => {
    assert.equal(normalizeEnvironment('test'), 'staging');
    assert.equal(normalizeEnvironment('uat'), 'staging');
    assert.equal(normalizeEnvironment('stage'), 'staging');
    assert.equal(normalizeEnvironment('prod'), 'production');
    assert.equal(normalizeEnvironment('live'), 'production');
    assert.equal(normalizeEnvironment('dev'), 'development');
    assert.equal(normalizeEnvironment('local'), 'development');
  });

  it('trims and lowercases', () => {
    assert.equal(normalizeEnvironment('  TEST  '), 'staging');
    assert.equal(normalizeEnvironment('Production'), 'production');
  });

  it('rejects unknown values', () => {
    assert.throws(
      () => normalizeEnvironment('qa'),
      /invalid environment 'qa'/i,
    );
    assert.throws(() => normalizeEnvironment(''), /requires `environment`/i);
  });
});
