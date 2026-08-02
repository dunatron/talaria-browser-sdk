import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { paintBaseSizeDetails } from '../src/replay/paint_base_size.js';
import {
  MAX_COMPRESSED_SEGMENT_BYTES,
  RRWEB_FULL_SNAPSHOT,
  RRWEB_META,
  SEGMENT_SIZE_BYTES,
  TARGET_COMPRESSED_SEGMENT_BYTES,
} from '../src/replay/segment_buffer.js';

describe('paintBaseSizeDetails', () => {
  it('reports meta and full snapshot estimated sizes', () => {
    const meta = { type: RRWEB_META, data: { href: '/admin' }, timestamp: 1 };
    const full = {
      type: RRWEB_FULL_SNAPSHOT,
      data: { node: { type: 0, childNodes: Array.from({ length: 50 }, () => ({ type: 2 })) } },
      timestamp: 2,
    };

    const details = paintBaseSizeDetails([meta, full], {
      fullSnapshotCompressedBytes: 1_500_000,
    });

    assert.deepEqual(details.segmentEventTypes, [RRWEB_META, RRWEB_FULL_SNAPSHOT]);
    assert.ok((details.metaEstimatedBytes ?? 0) > 0);
    assert.ok((details.fullSnapshotEstimatedBytes ?? 0) > (details.metaEstimatedBytes ?? 0));
    assert.equal(details.fullSnapshotCompressedBytes, 1_500_000);
    assert.equal(details.softTakeEstimatedBytes, SEGMENT_SIZE_BYTES);
    assert.equal(details.targetCompressedSegmentBytes, TARGET_COMPRESSED_SEGMENT_BYTES);
    assert.equal(details.maxCompressedSegmentBytes, MAX_COMPRESSED_SEGMENT_BYTES);
  });

  it('handles meta-only segments', () => {
    const details = paintBaseSizeDetails([
      { type: RRWEB_META, data: {}, timestamp: 1 },
    ]);
    assert.deepEqual(details.segmentEventTypes, [RRWEB_META]);
    assert.equal(details.fullSnapshotEstimatedBytes, undefined);
    assert.ok((details.metaEstimatedBytes ?? 0) > 0);
  });
});
