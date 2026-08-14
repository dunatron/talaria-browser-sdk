import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isSdkInternalNoise } from '../src/utils/sdk_internal_noise.ts';

describe('isSdkInternalNoise', () => {
  it('drops Failed to fetch stacks that only reference the SDK', () => {
    const stack = `TypeError: Failed to fetch
    at Ku.globalThis.fetch (https://cdn.jsdelivr.net/npm/@newtalaria/browser@0.1.12/+esm:140:14269)
    at ha.call (https://cdn.jsdelivr.net/npm/@newtalaria/browser@0.1.12/+esm:7:25373)
    at fa (https://cdn.jsdelivr.net/npm/@newtalaria/browser@0.1.12/+esm:7:26386)
    at Ro.capture (https://cdn.jsdelivr.net/npm/@newtalaria/browser@0.1.12/+esm:140:23396)
    at async Ro.captureException (https://cdn.jsdelivr.net/npm/@newtalaria/browser@0.1.12/+esm:140:19428)`;
    assert.equal(
      isSdkInternalNoise({ message: 'Failed to fetch', stack }),
      true,
    );
  });

  it('keeps app errors that mention the SDK fetch wrapper', () => {
    const stack = `TypeError: Failed to fetch
    at globalThis.fetch (https://cdn.jsdelivr.net/npm/@newtalaria/browser@0.1.13/+esm:140:1)
    at loadCart (https://www.dartriver.co.nz/js/app.js:42:10)`;
    assert.equal(
      isSdkInternalNoise({ message: 'Failed to fetch', stack }),
      false,
    );
  });

  it('ignores stacks with no URL frames', () => {
    assert.equal(
      isSdkInternalNoise({
        message: 'boom',
        stack: 'Error: boom\n    at foo (native)',
      }),
      false,
    );
  });

  it('drops Firefox rrweb stacks that only reference the SDK', () => {
    const stack = `Uo@https://cdn.jsdelivr.net/npm/@newtalaria/browser@0.1.22/+esm:67:1721
ne@https://cdn.jsdelivr.net/npm/@newtalaria/browser@0.1.22/+esm:67:1830
Hc/<@https://cdn.jsdelivr.net/npm/@newtalaria/browser@0.1.22/+esm:67:14055
Hc/</<@https://cdn.jsdelivr.net/npm/@newtalaria/browser@0.1.22/+esm:67:13042
Hc/<@https://cdn.jsdelivr.net/npm/@newtalaria/browser@0.1.22/+esm:67:13026
Hc/<@https://cdn.jsdelivr.net/npm/@newtalaria/browser@0.1.22/+esm:67:7345`;
    assert.equal(
      isSdkInternalNoise({
        message: 'Permission denied to access property "nodeType"',
        stack,
        filename:
          'https://cdn.jsdelivr.net/npm/@newtalaria/browser@0.1.22/+esm',
      }),
      true,
    );
  });

  it('drops Firefox DOM permission errors when onerror filename is the SDK', () => {
    assert.equal(
      isSdkInternalNoise({
        message: 'Permission denied to access property "nodeType"',
        filename:
          'https://cdn.jsdelivr.net/npm/@newtalaria/browser@0.1.22/+esm',
      }),
      true,
    );
  });

  it('keeps Firefox DOM permission errors from app code', () => {
    assert.equal(
      isSdkInternalNoise({
        message: 'Permission denied to access property "nodeType"',
        stack:
          'foo@https://ngaitahu.iwi.nz/themes/app.js:40:9\nbar@https://ngaitahu.iwi.nz/themes/app.js:12:1',
        filename: 'https://ngaitahu.iwi.nz/themes/app.js',
      }),
      false,
    );
  });
});
