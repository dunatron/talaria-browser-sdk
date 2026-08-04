import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  SEVERITY_ORDER,
  maxSeverity,
  normalizeSeverity,
  severityAtLeast,
} from '../src/utils/severity.js';

describe('severity helpers', () => {
  it('orders levels from debug to fatal', () => {
    assert.deepEqual(SEVERITY_ORDER, [
      'debug',
      'info',
      'warning',
      'error',
      'fatal',
    ]);
  });

  it('severityAtLeast compares ranks', () => {
    assert.equal(severityAtLeast('warning', 'warning'), true);
    assert.equal(severityAtLeast('error', 'warning'), true);
    assert.equal(severityAtLeast('info', 'warning'), false);
    assert.equal(severityAtLeast('fatal', 'debug'), true);
  });

  it('maxSeverity returns the stricter floor', () => {
    assert.equal(maxSeverity('debug', 'error'), 'error');
    assert.equal(maxSeverity('fatal', 'warning'), 'fatal');
    assert.equal(maxSeverity('info', 'info'), 'info');
  });

  it('normalizeSeverity maps aliases', () => {
    assert.equal(normalizeSeverity('warn'), 'warning');
    assert.equal(normalizeSeverity('NOTICE'), 'info');
    assert.equal(normalizeSeverity('critical'), 'fatal');
    assert.equal(normalizeSeverity('err'), 'error');
    assert.equal(normalizeSeverity('nope'), null);
  });
});
