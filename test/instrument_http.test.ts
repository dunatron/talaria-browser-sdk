import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { shouldInjectTraceparent } from '../src/tracing/instrument_http.ts';

const PAGE = 'https://app.example.com';

describe('shouldInjectTraceparent', () => {
  it('injects same-origin and allowlisted origins only', () => {
    assert.equal(
      shouldInjectTraceparent('https://app.example.com/api', {
        networkErrorOrigins: [],
        pageOrigin: PAGE,
        talariaBaseUrl: 'https://api.newtalaria.com',
      }),
      true,
    );
    assert.equal(
      shouldInjectTraceparent('https://api.stripe.com/v1', {
        networkErrorOrigins: ['https://api.stripe.com'],
        pageOrigin: PAGE,
        talariaBaseUrl: 'https://api.newtalaria.com',
      }),
      true,
    );
    assert.equal(
      shouldInjectTraceparent('https://www.google-analytics.com/g/collect', {
        networkErrorOrigins: [],
        pageOrigin: PAGE,
        talariaBaseUrl: 'https://api.newtalaria.com',
      }),
      false,
    );
  });

  it('never injects on Talaria span/event ingest URLs', () => {
    assert.equal(
      shouldInjectTraceparent('https://api.newtalaria.com/spans/ingestBatch', {
        networkErrorOrigins: ['*'],
        pageOrigin: PAGE,
        talariaBaseUrl: 'https://api.newtalaria.com',
      }),
      false,
    );
    assert.equal(
      shouldInjectTraceparent('https://api.newtalaria.com/events/ingest', {
        networkErrorOrigins: ['*'],
        pageOrigin: PAGE,
        talariaBaseUrl: 'https://api.newtalaria.com',
      }),
      false,
    );
  });
});
