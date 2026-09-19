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
    assert.equal(ctx.engine, 'Blink');
    assert.equal(ctx.webview, false);
  });

  it('parses Mobile Safari on iOS', () => {
    const ctx = parseBrowserContext(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    );
    assert.equal(ctx.name, 'Safari');
    assert.equal(ctx.version, '17.5');
    assert.equal(ctx.os, 'iOS');
    assert.equal(ctx.device, 'mobile');
    assert.equal(ctx.engine, 'WebKit');
    assert.equal(ctx.webview, false);
  });

  it('parses Firefox', () => {
    const ctx = parseBrowserContext(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0',
    );
    assert.equal(ctx.name, 'Firefox');
    assert.equal(ctx.version, '127.0');
    assert.equal(ctx.os, 'Windows');
    assert.equal(ctx.device, 'desktop');
    assert.equal(ctx.engine, 'Gecko');
    assert.equal(ctx.webview, false);
  });

  it('detects Instagram iOS in-app browser without inventing Safari-the-app', () => {
    const ctx = parseBrowserContext(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 26_6_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 441.0.0.29.79 IABMV/1 Safari/604.1',
    );
    assert.equal(ctx.name, 'Safari');
    assert.equal(ctx.engine, 'WebKit');
    assert.equal(ctx.os, 'iOS');
    assert.equal(ctx.webview, true);
    assert.equal(ctx.webviewHost, 'Instagram');
    assert.equal(ctx.webviewVersion, '441.0.0.29.79');
    const tags = browserContextTags(ctx);
    assert.equal(tags.webview, 'true');
    assert.equal(tags['webview.host'], 'Instagram');
    assert.equal(tags['browser.engine'], 'WebKit');
  });

  it('detects Facebook iOS in-app browser', () => {
    const ctx = parseBrowserContext(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 26_6_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/578.1.0.71.72;FBDV/iPhone]',
    );
    assert.equal(ctx.webview, true);
    assert.equal(ctx.webviewHost, 'Facebook');
    assert.equal(ctx.webviewVersion, '578.1.0.71.72');
    assert.equal(ctx.engine, 'WebKit');
  });

  it('detects Facebook Android WebView', () => {
    const ctx = parseBrowserContext(
      'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/450.0.0.0.0;]',
    );
    assert.equal(ctx.name, 'Chrome');
    assert.equal(ctx.engine, 'Blink');
    assert.equal(ctx.webview, true);
    assert.equal(ctx.webviewHost, 'Facebook');
  });

  it('detects TikTok in-app browser', () => {
    const ctx = parseBrowserContext(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 musical_ly_40.0.0 BytedanceWebview/d8a2c75',
    );
    assert.equal(ctx.webview, true);
    assert.equal(ctx.webviewHost, 'TikTok');
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
