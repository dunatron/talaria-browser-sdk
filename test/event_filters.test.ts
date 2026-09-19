import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_IGNORE_ERRORS,
  shouldDropCapturedError,
  shouldIgnoreErrorMessage,
} from '../src/utils/event_filters.js';

describe('event_filters', () => {
  it('drops the Meta Autofill callback by default', () => {
    assert.equal(
      shouldIgnoreErrorMessage(
        "Can't find variable: _AutofillCallbackHandler",
        DEFAULT_IGNORE_ERRORS,
      ),
      true,
    );
  });

  it('drops ResizeObserver and Script error defaults', () => {
    assert.equal(
      shouldIgnoreErrorMessage(
        'ResizeObserver loop limit exceeded',
        DEFAULT_IGNORE_ERRORS,
      ),
      true,
    );
    assert.equal(
      shouldIgnoreErrorMessage('Script error.', DEFAULT_IGNORE_ERRORS),
      true,
    );
  });

  it('drops iOS Chrome Translate and ethereum wallet redefine defaults', () => {
    assert.equal(
      shouldIgnoreErrorMessage(
        "undefined is not an object (evaluating 'a.L')",
        DEFAULT_IGNORE_ERRORS,
      ),
      true,
    );
    assert.equal(
      shouldIgnoreErrorMessage(
        'can\'t redefine non-configurable property "ethereum"',
        DEFAULT_IGNORE_ERRORS,
      ),
      true,
    );
  });

  it('keeps application errors', () => {
    assert.equal(
      shouldIgnoreErrorMessage('Checkout failed', DEFAULT_IGNORE_ERRORS),
      false,
    );
  });

  it('drops via ignoreUrls stack match', () => {
    assert.equal(
      shouldDropCapturedError({
        message: 'boom',
        stack: 'at x (https://connect.facebook.net/sdk.js:1:1)',
        ignoreErrors: [],
        ignoreUrls: [/facebook\.net/],
      }),
      true,
    );
  });

  it('does not drop first-party errors', () => {
    assert.equal(
      shouldDropCapturedError({
        message: 'boom',
        stack: 'at checkout (https://hollyford.nz/app.js:10:1)',
        ignoreErrors: DEFAULT_IGNORE_ERRORS,
        ignoreUrls: [],
      }),
      false,
    );
  });
});
