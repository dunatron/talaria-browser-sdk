import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  browserContextTags,
  detectBot,
  parseBrowserContext,
} from '../src/utils/browser_context.js';

describe('parseBrowserContext', () => {
  it('parses Chrome on macOS', () => {
    const ctx = parseBrowserContext(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      'en-NZ',
    );
    assert.equal(ctx.name, 'Chrome');
    assert.equal(ctx.version, '126.0.0.0');
    assert.equal(ctx.os, 'macOS');
    assert.equal(ctx.osVersion, '10.15.7');
    assert.equal(ctx.device, 'desktop');
    assert.equal(ctx.language, 'en-NZ');
    assert.equal(ctx.bot, false);
  });

  it('parses Mobile Safari on iOS', () => {
    const ctx = parseBrowserContext(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    );
    assert.equal(ctx.name, 'Safari');
    assert.equal(ctx.version, '17.5');
    assert.equal(ctx.os, 'iOS');
    assert.equal(ctx.device, 'mobile');
  });

  it('parses Firefox', () => {
    const ctx = parseBrowserContext(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0',
    );
    assert.equal(ctx.name, 'Firefox');
    assert.equal(ctx.version, '127.0');
    assert.equal(ctx.os, 'Windows');
    assert.equal(ctx.device, 'desktop');
  });

  it('detects Baiduspider without inventing a browser', () => {
    const ua =
      'Mozilla/5.0 (compatible; Baiduspider-render/2.0; +http://www.baidu.com/search/spider.html)';
    const ctx = parseBrowserContext(ua, 'zh-CN');
    assert.equal(ctx.bot, true);
    assert.equal(ctx.botName, 'Baiduspider');
    assert.equal(ctx.name, 'unknown');
    assert.equal(ctx.device, 'desktop');
    const tags = browserContextTags(ctx);
    assert.equal(tags.bot, 'true');
    assert.equal(tags['bot.name'], 'Baiduspider');
  });

  it('builds triage tags', () => {
    const tags = browserContextTags(
      parseBrowserContext(
        'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126.0.0.0 Mobile Safari/537.36',
      ),
    );
    assert.equal(tags['browser.name'], 'Chrome');
    assert.equal(tags['os.name'], 'Android');
    assert.equal(tags.device, 'mobile');
    assert.equal(tags.bot, undefined);
  });
});

describe('detectBot', () => {
  it('recognizes Googlebot', () => {
    assert.deepEqual(
      detectBot('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'),
      { bot: true, botName: 'Googlebot' },
    );
  });

  it('returns false for normal browsers', () => {
    assert.deepEqual(
      detectBot(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149.0.0.0 Safari/537.36',
      ),
      { bot: false },
    );
  });
});
