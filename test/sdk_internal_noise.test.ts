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
});
