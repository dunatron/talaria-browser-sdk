import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applySourceLocation,
  isInAppFrame,
  parseStackLine,
  parseStackTrace,
} from '../src/utils/stacktrace.ts';

const PAGE = { pageOrigin: 'https://www.dartriver.co.nz' };

describe('parseStackTrace', () => {
  it('parses V8 frames oldest → newest with functionName', () => {
    const stack = `TypeError: boom
    at crash (http://app.example.com/app.js:40:9)
    at handler (http://app.example.com/app.js:20:3)
    at http://app.example.com/boot.js:5:1`;

    const parsed = parseStackTrace(stack, {
      pageOrigin: 'http://app.example.com',
    });
    assert.ok(parsed);
    assert.equal(parsed!.frames.length, 3);

    // Oldest first
    assert.equal(parsed!.frames[0]!.functionName, undefined);
    assert.equal(parsed!.frames[0]!.filename, 'boot.js');
    assert.equal(parsed!.frames[0]!.lineno, 5);
    assert.equal(parsed!.frames[0]!.colno, 1);

    assert.equal(parsed!.frames[1]!.functionName, 'handler');
    assert.equal(parsed!.frames[1]!.absPath, 'http://app.example.com/app.js');
    assert.equal(parsed!.frames[1]!.lineno, 20);

    // Newest (crash site) last
    assert.equal(parsed!.frames[2]!.functionName, 'crash');
    assert.equal(parsed!.frames[2]!.lineno, 40);
    assert.equal(parsed!.frames[2]!.colno, 9);
    assert.equal(parsed!.frames[2]!.inApp, true);
    assert.equal(parsed!.frames[2]!.platform, 'javascript');
  });

  it('marks third-party CDN and SDK frames as not inApp', () => {
    const stack = `NetworkError: Failed to load
    at Ah.r.send (https://cdn.jsdelivr.net/npm/@newtalaria/browser@0.1.18/+esm:141:20535)
    at a.o (https://s.pinimg.com/ct/core.js:1:2331)
    at run (https://www.dartriver.co.nz/themes/app.js:10:1)`;

    const parsed = parseStackTrace(stack, PAGE);
    assert.ok(parsed);
    assert.equal(parsed!.frames.length, 3);
    assert.equal(parsed!.frames[0]!.inApp, true); // same-origin app
    assert.equal(parsed!.frames[1]!.inApp, false); // pinimg
    assert.equal(parsed!.frames[2]!.inApp, false); // talaria SDK CDN
  });

  it('marks node_modules and extensions as not inApp', () => {
    assert.equal(
      isInAppFrame('http://app.example.com/node_modules/lodash/index.js', {
        pageOrigin: 'http://app.example.com',
      }),
      false,
    );
    assert.equal(
      isInAppFrame('chrome-extension://abcdef/content.js', {
        pageOrigin: 'http://app.example.com',
      }),
      false,
    );
    assert.equal(
      isInAppFrame('http://app.example.com/src/main.js', {
        pageOrigin: 'http://app.example.com',
      }),
      true,
    );
  });

  it('treats absolute cross-origin URLs as not inApp without pageOrigin match', () => {
    assert.equal(
      isInAppFrame('https://s.pinimg.com/ct/core.js', PAGE),
      false,
    );
    assert.equal(
      isInAppFrame(
        'https://cdn.jsdelivr.net/npm/@newtalaria/browser@0.1.18/+esm',
        PAGE,
      ),
      false,
    );
  });

  it('honors inAppOrigins for CDN-hosted app bundles', () => {
    assert.equal(
      isInAppFrame('https://cdn.example.com/app/main.js', {
        pageOrigin: 'https://www.example.com',
        inAppOrigins: ['https://cdn.example.com'],
      }),
      true,
    );
  });

  it('honors allowUrls and denyUrls', () => {
    assert.equal(
      isInAppFrame('https://vendor.example.com/widget.js', {
        ...PAGE,
        allowUrls: [/vendor\.example\.com/],
      }),
      true,
    );
    assert.equal(
      isInAppFrame('https://www.dartriver.co.nz/legacy/bad.js', {
        ...PAGE,
        denyUrls: ['/legacy/'],
      }),
      false,
    );
  });

  it('treats relative and webpack paths as inApp', () => {
    assert.equal(isInAppFrame('webpack:///src/app.ts', PAGE), true);
    assert.equal(isInAppFrame('src/main.js', PAGE), true);
  });

  it('parses bare at frames without location', () => {
    const bare = parseStackLine('    at Object.<anonymous>');
    assert.ok(bare);
    assert.equal(bare!.functionName, 'Object.<anonymous>');
    assert.equal(bare!.inApp, false);
    assert.equal(bare!.absPath, undefined);
  });

  it('applySourceLocation enriches newest frame', () => {
    const stack = parseStackTrace(
      `Error: x
    at boom (http://app.example.com/a.js:1:1)
    at run (http://app.example.com/b.js:2:2)`,
      { pageOrigin: 'http://app.example.com' },
    );
    const enriched = applySourceLocation(
      stack,
      {
        filename: 'http://app.example.com/override.js',
        lineno: 99,
        colno: 7,
      },
      { pageOrigin: 'http://app.example.com' },
    );
    assert.ok(enriched);
    const top = enriched!.frames[enriched!.frames.length - 1]!;
    assert.equal(top.absPath, 'http://app.example.com/override.js');
    assert.equal(top.filename, 'override.js');
    assert.equal(top.lineno, 99);
    assert.equal(top.colno, 7);
    assert.equal(top.inApp, true);
  });

  it('applySourceLocation synthesizes a frame when stack is empty', () => {
    const enriched = applySourceLocation(
      undefined,
      {
        filename: 'http://app.example.com/inline.js',
        lineno: 3,
      },
      { pageOrigin: 'http://app.example.com' },
    );
    assert.ok(enriched);
    assert.equal(enriched!.frames.length, 1);
    assert.equal(enriched!.frames[0]!.filename, 'inline.js');
    assert.equal(enriched!.frames[0]!.lineno, 3);
    assert.equal(enriched!.frames[0]!.inApp, true);
  });
});
