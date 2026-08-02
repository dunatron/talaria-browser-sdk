import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { redactUrl, sanitizeNetworkUrl } from '../src/replay/privacy.ts';

describe('sanitizeNetworkUrl', () => {
  it('strips query and fragment by default', () => {
    const ga =
      'https://www.google-analytics.com/g/collect?v=2&tid=G-NKDW3BEWF6&cid=1013995338.1785104462&sid=1785104461&dl=https%3A%2F%2Fwww.dartriver.co.nz%2F#frag';
    assert.deepEqual(sanitizeNetworkUrl(ga), {
      url: 'https://www.google-analytics.com/g/collect',
      hostname: 'www.google-analytics.com',
      pathname: '/g/collect',
    });
  });

  it('keeps redacted query when opted in', () => {
    const raw =
      'https://api.example.com/v1/items?id=1&token=secret&ok=true';
    const parts = sanitizeNetworkUrl(raw, { includeQuery: true });
    assert.equal(parts.hostname, 'api.example.com');
    assert.equal(parts.pathname, '/v1/items');
    assert.equal(parts.search?.includes('token=%5BFiltered%5D') || parts.search?.includes('token=[Filtered]'), true);
    assert.equal(parts.search?.includes('ok=true'), true);
    assert.equal(parts.url.startsWith('https://api.example.com/v1/items?'), true);
  });

  it('redacts advertising / analytics identifiers when query capture is on', () => {
    const raw =
      'https://ads.example.com/click?gclid=abc&fbclid=def&gcl_au=1&_ga=GA1.1&_ga_XYZ=2&cid=9&sid=8&msclkid=m&keep=yes';
    const parts = sanitizeNetworkUrl(raw, { includeQuery: true });
    for (const key of [
      'gclid',
      'fbclid',
      'gcl_au',
      '_ga',
      '_ga_XYZ',
      'cid',
      'sid',
      'msclkid',
    ]) {
      assert.equal(
        parts.search?.includes(`${key}=[Filtered]`) ||
          parts.search?.includes(`${key}=%5BFiltered%5D`),
        true,
        `expected ${key} filtered`,
      );
    }
    assert.equal(parts.search?.includes('keep=yes'), true);
  });

  it('resolves relative URLs against a base', () => {
    assert.deepEqual(
      sanitizeNetworkUrl('/api/cart?x=1', {
        baseHref: 'https://shop.example.com/page',
      }),
      {
        url: 'https://shop.example.com/api/cart',
        hostname: 'shop.example.com',
        pathname: '/api/cart',
      },
    );
  });
});

describe('redactUrl', () => {
  it('filters sensitive query keys but keeps others', () => {
    const out = redactUrl('https://example.com/?q=1&api_key=abc&x=2');
    assert.match(out, /api_key=(?:\[Filtered\]|%5BFiltered%5D)/);
    assert.equal(out.includes('q=1'), true);
    assert.equal(out.includes('x=2'), true);
  });

  it('filters gclid and fbclid', () => {
    const out = redactUrl('https://example.com/?gclid=x&fbclid=y&q=1');
    assert.match(out, /gclid=(?:\[Filtered\]|%5BFiltered%5D)/);
    assert.match(out, /fbclid=(?:\[Filtered\]|%5BFiltered%5D)/);
    assert.equal(out.includes('q=1'), true);
  });
});
