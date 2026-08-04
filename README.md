# `@newtalaria/browser`

Official browser SDK for [Talaria](https://www.newtalaria.com) — capture exceptions and application logs, and record **session replay** (rrweb event streams, not video) so your team can see what users did before an issue.

Docs: [JavaScript SDK guide](https://www.newtalaria.com/docs/sdk/javascript) · Dashboard: [one.newtalaria.com](https://one.newtalaria.com)

## Install

```bash
npm install @newtalaria/browser
```

### Script tag (no bundler)

Load the IIFE build from a CDN or your own static host, then call `Talaria.init`:

```html
<script src="https://cdn.jsdelivr.net/npm/@newtalaria/browser/dist/talaria.browser.iife.js"></script>
<script>
  Talaria.init({
    dsn: 'https://api.newtalaria.com',
    apiKey: 'tal_live_…',
    environment: 'production',
    minLevel: 'warning',
  });
</script>
```

Pin a version in production (for example `@newtalaria/browser@0.1.21`) instead of floating on `latest`.

## Initialize (best practices)

Create a client key under **Project settings → Client keys** (`tal_live_…`). Use your project’s API base URL as `dsn` (Talaria Cloud: `https://api.newtalaria.com`).

```ts
import { Talaria } from '@newtalaria/browser';

Talaria.init({
  dsn: 'https://api.newtalaria.com',
  apiKey: 'tal_live_…',
  environment: 'production', // staging | development also accepted
  release: '1.4.2',          // deploy / git SHA — first-class field, not a tag
  minLevel: 'warning',       // production: drop info/debug noise
  tags: {
    service: 'storefront',
    platform: 'web',
  },
  // Cheapest useful replay profile (also the defaults):
  replaysSessionSampleRate: 0,   // no continuous upload
  replaysOnErrorSampleRate: 1,   // clip around errors
  replaysErrorAfterMs: 15_000,   // ~15s after the error
  maskAllInputs: true,
});
```

**Recommendations**

| Concern | Production default |
| --- | --- |
| Log volume | `minLevel: 'warning'` (use `'info'` / `'debug'` only when you intentionally want noisier capture) |
| Replay cost | Keep `replaysSessionSampleRate` low or `0`; rely on on-error clips |
| Identity | Set `userId` when you know the signed-in user |
| Product dims | Put stable filters in init `tags` (`service`, `platform`) |
| Privacy | Leave `maskAllInputs: true`; mark sensitive DOM with `data-talaria-mask` |

`Talaria.init` installs `window.onerror` / `unhandledrejection` handlers unless you pass `disableDefaultIntegrations: true`. Opaque cross-origin `"Script error."` events and browser-extension noise are ignored by default.

`environment` must resolve to `production` | `staging` | `development`. Common aliases work (`prod` / `live` → `production`, `test` / `uat` → `staging`, `dev` / `local` → `development`). Invalid values throw at `init`.

## Logging

Prefer a scoped logger for application code. Level methods wrap `captureMessage`; use `captureException` for throwables.

```ts
const logger = Talaria.logger({
  tags: { feature: 'checkout', operation: 'pay' },
});

await logger.info('Checkout opened');           // filtered if minLevel is warning
await logger.warn('Payment method missing');

try {
  await charge();
} catch (error) {
  await logger.captureException(error, {
    tags: { component: 'stripe' },
    extra: { cart_id: 'abc123' },
  });
  throw error;
}
```

| Method | Severity sent |
| --- | --- |
| `debug` / `info` / `warning` / `error` / `fatal` | same name |
| `warn` | `warning` |
| `log(level, message, context?)` | `level` |
| `captureException(error, context?)` | `error` |

Also available on the root `Talaria` facade (`Talaria.warn(…)`, etc.).  
`Talaria.withTags({ … })` is shorthand for `Talaria.logger({ tags: { … } })`.  
Low-level `captureMessage(message, level?, context?)` remains supported.

### Filtering

Gates run in order. Filtered calls still resolve successfully (no throw).

1. **`minLevel`** (default `'debug'`) — drop below this severity. Applies to messages, `captureException` (as `'error'`), and automatic integrations.
2. **`sampleRate`** (default `1`) — fraction of eligible events to send. Independent of replay sample rates.
3. **`beforeSend(event, hint)`** — return `null` to drop, or a mutated event. Not called when earlier gates already dropped the capture.

Scoped loggers can only **raise** the floor:

```ts
const payments = logger.child({
  tags: { component: 'payments' },
  minLevel: 'error', // cannot weaken a stricter global minLevel
});

if (logger.isLevelEnabled('info')) {
  // build expensive context only when it would send
}
```

Browser `console.*` hooks add **replay breadcrumbs only**. They are not gated by `minLevel` and do not create Talaria events.

## Good patterns

### Feature-scoped logger per flow

```ts
function createCheckoutLogger(step: string) {
  return Talaria.logger({
    tags: { feature: 'checkout', operation: step },
  });
}

const logger = createCheckoutLogger('review');
await logger.warn('Address validation failed', {
  extra: { field: 'postcode' },
});
```

### Tags vs `extra`

| Use | For | Examples |
| --- | --- | --- |
| **tags** | Low-cardinality dimensions you filter/group on | `feature`, `operation`, `component`, `service` |
| **extra** | High-cardinality diagnostics | `cart_id`, payloads, counts, free-form detail |

```ts
await logger.error('Charge declined', {
  tags: { component: 'stripe', operation: 'charge' },
  extra: { cart_id: 'cart_01H…', decline_code: 'insufficient_funds' },
});
```

### Child logger that only sends errors

```ts
const analytics = Talaria.logger({ tags: { feature: 'analytics' } }).withMinLevel(
  'error',
);
await analytics.info('page_view'); // no-op when floor is error
await analytics.captureException(err);
```

### Redact before send

```ts
Talaria.init({
  dsn: 'https://api.newtalaria.com',
  apiKey: 'tal_live_…',
  environment: 'production',
  minLevel: 'warning',
  beforeSend(event) {
    if (event.message.toLowerCase().includes('password')) return null;
    if (event.extra && 'rawCard' in event.extra) {
      const { rawCard: _, ...extra } = event.extra;
      return { ...event, extra };
    }
    return event;
  },
});
```

### Severity guidance

- **`warn` / `error` / `fatal`** — user-impacting or actionable problems (default production traffic when `minLevel: 'warning'`).
- **`info`** — intentional product signals (funnel steps, “empty state”) when you lower `minLevel` or run in staging.
- **`debug`** — local diagnosis only; leave filtered out in production.

## Tags

Preferred conventions (optional, but useful in the dashboard):

`service`, `platform`, `feature`, `operation`, `component`, `runtime`, `runtime_version`

**Merge order (later wins):** automatic browser tags → init `tags` → logger / `withTags` scope → per-call `context.tags`.

**Limits:** max 20 tags per event, key ≤64 (`[a-z0-9_.-]`), value ≤128, ~2KB total. Invalid keys are dropped. In non-production, high-cardinality-looking keys/values log a console warning.

Do **not** put `environment` or `release` in tags — use the first-class init fields. Do **not** put user ids, emails, order ids, or URLs in tags — use `userId` / `extra`.

Every event also gets automatic browser triage tags such as `browser.name`, `os.name`, and `device`.

## Session replay

You pay for **uploaded + retained** replay data, not for local buffering. Prefer on-error clips in production.

| Traffic | `replaysSessionSampleRate` | `replaysOnErrorSampleRate` | `replaysErrorAfterMs` |
| --- | --- | --- | --- |
| High | `0.01` | `1.0` | `15000` (default) |
| Medium | `0.1` | `1.0` | `15000` |
| Low | `0.25` | `1.0` | `15000` |
| Marketing / docs | `0` | `1.0` | `15000` |
| Richer post-error context | `0` | `1.0` | `0` (continue until session cap) |

**Defaults (`session=0`, `onError=1`, `errorAfterMs=15000`)** are the cheapest useful profile: quiet traffic uploads nothing; each sampled error keeps ~60s before + ~15s after.

| Mode | What happens |
| --- | --- |
| Session sample hit | Continuous upload for the page session (until unload or max duration) |
| Session sample miss | Record into a local ring buffer; nothing uploaded until an error sample hits |
| Error sample | Upload the buffer + a short trailing window, attach `replayId` when segments land, then return to buffer mode |

When an error clip cannot be uploaded, the error event may include:

| Tag | Meaning |
| --- | --- |
| `replay.capture` | `ok` \| `failed` \| `skipped` |
| `replay.capture_reason` | Why a clip failed or was skipped (e.g. `not_sampled`, `upload_failed`) |

Failed captures do **not** set `replayId` (avoids linking an empty player).

### Privacy

- `maskAllInputs: true` by default (password fields masked).
- Block sensitive nodes with `data-talaria-mask` or `blockSelector`.
- For **login-protected admin CSS**, set `inlineStylesheet: true` so same-origin styles are embedded while the user is logged in. Public sites usually leave this `false`.

## Failed HTTP / network requests

All instrumented `fetch` / XHR calls are recorded as replay breadcrumbs. **Error events are promoted only for first-party (same-origin) or allowlisted origins** — so analytics, ads, and widgets do not spam Issues.

| Request | HTTP 5xx | Transport failure / timeout | Abort |
| --- | --- | --- | --- |
| Same-origin | Error event | Error event | Breadcrumb only |
| Allowlisted (`networkErrorOrigins`) | Error event | Error event | Breadcrumb only |
| Other third-party | Breadcrumb only | Breadcrumb only | Breadcrumb only |

```ts
Talaria.init({
  dsn: 'https://api.newtalaria.com',
  apiKey: 'tal_live_…',
  environment: 'production',
  minLevel: 'warning',
  captureFailedRequests: true,
  captureNetworkErrors: true,
  networkErrorOrigins: ['https://api.stripe.com'],
  captureRequestQueryParameters: false, // default — strip ?query from network URLs
  failedRequestStatusCodes: [[500, 599]], // CMS admin often uses [[400, 599]]
  failedRequestIgnoreUrls: ['/health'],
});
```

Query strings are stripped from network telemetry by default. Bodies and auth headers are never captured. `AbortError` is never promoted.

## Init options

| Option | Default | Description |
| --- | --- | --- |
| `dsn` / `baseUrl` | *(required)* | Talaria API base URL, e.g. `https://api.newtalaria.com` |
| `apiKey` | *(required)* | Public client key (`tal_live_…`). Safe to embed; configure allowed domains in the dashboard for production. |
| `environment` | *(required)* | `production` \| `staging` \| `development` (aliases accepted) |
| `release` | — | Optional release string on every event |
| `userId` | — | Optional app user id |
| `tags` | — | Tags merged into every event |
| `minLevel` | `'debug'` | Drop captures below this severity; use `'warning'` in production |
| `sampleRate` | `1` | Fraction of eligible events to send (after `minLevel`) |
| `beforeSend` | — | `(event, hint) => event \| null` — mutate or drop after gates |
| `replaysSessionSampleRate` | `0` | Fraction of sessions that upload continuously |
| `replaysOnErrorSampleRate` | `1` | Fraction of errors that promote the ring buffer |
| `replaysErrorAfterMs` | `15000` | Post-error upload window; `0` = continue until session cap |
| `maskAllInputs` | `true` | Mask inputs in replay |
| `inlineStylesheet` | `false` | Embed same-origin CSS (auth-gated admin UIs) |
| `blockSelector` | — | Extra CSS selectors blocked from the DOM snapshot |
| `disableDefaultIntegrations` | `false` | Skip `window.onerror` / `unhandledrejection` |
| `captureFailedRequests` | `true` | Promote HTTP status failures (first-party / allowlisted only) |
| `captureNetworkErrors` | `true` | Promote transport/timeout failures (first-party / allowlisted only) |
| `networkErrorOrigins` | `[]` | Extra origins eligible for promotion; `['*']` = all (not recommended) |
| `failedRequestStatusCodes` | `[[500, 599]]` | Status codes/ranges to promote when origin is eligible |
| `failedRequestIgnoreUrls` | `[]` | URL substrings never promoted |
| `captureRequestQueryParameters` | `false` | Keep `?query` on network URLs after redaction |
| `inAppOrigins` | `[]` | Extra origins treated as app code for stack `inApp` |
| `inAppAllowUrls` / `inAppDenyUrls` | `[]` | Force stack frames `inApp: true` / `false` |

## Public API

| API | Description |
| --- | --- |
| `Talaria.init(options)` | Configure + start recording + install network/console hooks |
| `Talaria.logger(options?)` | Scoped logger (`tags`, `minLevel`) |
| `Talaria.withTags(tags)` | Shorthand for `logger({ tags })` |
| `Talaria.debug` / `info` / `warning` / `warn` / `error` / `fatal` | Level helpers |
| `Talaria.log(level, message, context?)` | Generic level helper |
| `Talaria.captureException(error, context?)` | Ingest error (+ replay link when sampled) |
| `Talaria.captureMessage(message, level?, context?)` | Ingest message |
| `Talaria.getMinLevel()` / `setMinLevel(level)` | Read/update global floor |
| `Talaria.isLevelEnabled(level)` | Whether a level would pass the global floor |
| `Talaria.getReplayId()` | Active upload replay id, or `null` |
| `Talaria.flush()` | Upload buffered replay segments |
| `Talaria.close()` | Stop recording, flush, finish |

Scoped loggers also expose `child`, `withMinLevel`, `withTags`, `isLevelEnabled`, and `getMinLevel`.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| 401 / 403 | Client key (`tal_live_…`) belongs to the project; allowed domains configured for production |
| `logger.info` never appears | `minLevel` is often `'warning'` in production — lower it or use `warn` / `error` |
| Exceptions missing after `setMinLevel('fatal')` | `captureException` counts as `'error'` and is filtered by a `fatal` floor |
| No replay on an error | Check `replay.capture` / `replay.capture_reason` on the event; clip may have been skipped or failed to upload |
| Permanent ingest 4xx | Misconfigured env/auth/payload disables further capture for that page session so the SDK cannot spin forever |

More guides: [www.newtalaria.com/docs](https://www.newtalaria.com/docs)
