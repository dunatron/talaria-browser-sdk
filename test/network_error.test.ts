import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  classifyTransportFailure,
  describeUnknownError,
  isAbortError,
  isCorrelatableTransportError,
  isLikelyNetworkFetchError,
  isTimeoutError,
} from '../src/utils/network_error.ts';

describe('network_error helpers', () => {
  it('detects AbortError', () => {
    const err = new Error('The user aborted a request.');
    err.name = 'AbortError';
    assert.equal(isAbortError(err), true);
    assert.equal(isLikelyNetworkFetchError(err), false);
  });

  it('detects TimeoutError for correlation', () => {
    const err = new Error('timed out');
    err.name = 'TimeoutError';
    assert.equal(isTimeoutError(err), true);
    assert.equal(isLikelyNetworkFetchError(err), false);
    assert.equal(isCorrelatableTransportError(err), true);
  });

  it('detects common fetch transport messages', () => {
    assert.equal(
      isLikelyNetworkFetchError(new TypeError('Failed to fetch')),
      true,
    );
    assert.equal(isLikelyNetworkFetchError(new TypeError('Load failed')), true);
    const ff = new TypeError(
      'NetworkError when attempting to fetch resource.',
    );
    assert.equal(isLikelyNetworkFetchError(ff), true);
  });

  it('describeUnknownError truncates and flags abort/timeout', () => {
    const aborted = new Error('x');
    aborted.name = 'AbortError';
    assert.deepEqual(describeUnknownError(aborted), {
      errorName: 'AbortError',
      errorMessage: 'x',
      aborted: true,
      timedOut: false,
    });

    const timedOut = new Error('timed out');
    timedOut.name = 'TimeoutError';
    assert.deepEqual(describeUnknownError(timedOut), {
      errorName: 'TimeoutError',
      errorMessage: 'timed out',
      aborted: false,
      timedOut: true,
    });
  });

  it('classifyTransportFailure never invents cors from status 0', () => {
    assert.equal(classifyTransportFailure({}), 'network');
    assert.equal(
      classifyTransportFailure({ errorName: 'NetworkError' }),
      'network',
    );
    assert.equal(
      classifyTransportFailure({ aborted: true, errorName: 'AbortError' }),
      'abort',
    );
    assert.equal(
      classifyTransportFailure({ timedOut: true }),
      'timeout',
    );
  });
});
