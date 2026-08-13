import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BreadcrumbBuffer,
  consoleBreadcrumb,
  MAX_BREADCRUMBS,
  networkBreadcrumb,
} from '../src/tracing/breadcrumbs.ts';

describe('breadcrumb ring buffer', () => {
  it('caps at 50 and snapshot returns the last N', () => {
    const buf = new BreadcrumbBuffer();
    for (let i = 0; i < 60; i++) {
      buf.add(consoleBreadcrumb('info', `msg-${i}`));
    }
    assert.equal(buf.size, MAX_BREADCRUMBS);
    const all = buf.snapshot();
    assert.equal(all.length, 50);
    assert.equal(all[0]!.message, 'msg-10');
    assert.equal(all[49]!.message, 'msg-59');
    assert.equal(buf.snapshot(3).map((c) => c.message).join(','), 'msg-57,msg-58,msg-59');
  });

  it('maps fetch meta onto http breadcrumbs', () => {
    const crumb = networkBreadcrumb({
      method: 'POST',
      url: 'https://app.example.com/api',
      status: 500,
      durationMs: 12,
      ok: false,
      transport: 'fetch',
      failureKind: 'http',
    });
    assert.equal(crumb.type, 'http');
    assert.equal(crumb.category, 'fetch');
    assert.equal(crumb.level, 'error');
    assert.equal(crumb.data?.method, 'POST');
    assert.equal(crumb.data?.status_code, '500');
  });
});
