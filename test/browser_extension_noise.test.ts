import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isBrowserExtensionNoise } from '../src/utils/browser_extension_noise.js';

describe('isBrowserExtensionNoise', () => {
  it('drops chrome-extension filename', () => {
    assert.equal(
      isBrowserExtensionNoise({
        filename: 'chrome-extension://kjjlicpbekhmdbpdmlamhpmmgkgmnbll/src/setup.js',
        message: 'Failed to execute postMessage',
      }),
      true,
    );
  });

  it('drops when stack is dominated by extension frames', () => {
    assert.equal(
      isBrowserExtensionNoise({
        message: 'DataCloneError',
        stack:
          "Error: Failed to execute 'postMessage'\n" +
          '    at chrome-extension://abc/src/setup.js:27:10\n' +
          '    at https://widget.yonderhq.com/main.js:22:1',
      }),
      true,
    );
  });

  it('keeps same-origin app errors', () => {
    assert.equal(
      isBrowserExtensionNoise({
        filename: 'https://www.dartriver.co.nz/assets/app.js',
        stack:
          'TypeError: x is not a function\n    at https://www.dartriver.co.nz/assets/app.js:10:1',
        message: 'x is not a function',
      }),
      false,
    );
  });

  it('keeps third-party widget errors without extension frames', () => {
    assert.equal(
      isBrowserExtensionNoise({
        filename: 'https://widget.yonderhq.com/main.js',
        stack: 'Error: boom\n    at https://widget.yonderhq.com/main.js:1:1',
        message: 'boom',
      }),
      false,
    );
  });
});
