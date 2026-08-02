import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isOpaqueCrossOriginScriptError } from '../src/utils/opaque_script_error.js';

describe('isOpaqueCrossOriginScriptError', () => {
  it('drops classic Script error. with no Error object', () => {
    assert.equal(
      isOpaqueCrossOriginScriptError({ message: 'Script error.' }),
      true,
    );
    assert.equal(
      isOpaqueCrossOriginScriptError({ message: 'Script error' }),
      true,
    );
  });

  it('keeps Script error. when a real Error is present', () => {
    assert.equal(
      isOpaqueCrossOriginScriptError({
        message: 'Script error.',
        error: new Error('Script error.'),
      }),
      false,
    );
  });

  it('keeps normal same-origin messages', () => {
    assert.equal(
      isOpaqueCrossOriginScriptError({
        message: 'Cannot read properties of undefined',
        error: new TypeError('Cannot read properties of undefined'),
      }),
      false,
    );
    assert.equal(
      isOpaqueCrossOriginScriptError({ message: 'boom' }),
      false,
    );
  });
});
