import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  REPLAY_CAPTURE_REASON_TAG,
  REPLAY_CAPTURE_TAG,
  applyReplayCaptureTags,
  mergeReplayCaptureExtra,
} from '../src/replay/capture_outcome.js';

describe('replay capture outcome tags', () => {
  it('applies failed tags and extra', () => {
    const tags = applyReplayCaptureTags(
      { runtime: 'silverstripe-cms' },
      {
        status: 'failed',
        reason: 'oversized_full_snapshot',
        details: { source: 'fit' },
      },
    );
    assert.equal(tags[REPLAY_CAPTURE_TAG], 'failed');
    assert.equal(tags[REPLAY_CAPTURE_REASON_TAG], 'oversized_full_snapshot');
    assert.equal(tags.runtime, 'silverstripe-cms');

    const extra = mergeReplayCaptureExtra(
      { url: '/admin' },
      {
        status: 'failed',
        reason: 'oversized_full_snapshot',
        details: { source: 'fit' },
      },
    );
    assert.deepEqual(extra?.replayCapture, {
      attempted: true,
      status: 'failed',
      reason: 'oversized_full_snapshot',
      source: 'fit',
    });
    assert.equal(extra?.url, '/admin');
  });

  it('skips extra enrichment for ok', () => {
    const extra = mergeReplayCaptureExtra({ a: 1 }, { status: 'ok' });
    assert.deepEqual(extra, { a: 1 });
  });

  it('applies skipped not_sampled', () => {
    const tags = applyReplayCaptureTags({}, {
      status: 'skipped',
      reason: 'not_sampled',
    });
    assert.equal(tags[REPLAY_CAPTURE_TAG], 'skipped');
    assert.equal(tags[REPLAY_CAPTURE_REASON_TAG], 'not_sampled');
  });
});
