# `@newtalaria/browser`

Browser SDK for [Talaria](https://github.com/) — error capture and **session replay** (rrweb event streams, not video).

Network calls (`fetch` / XHR) are instrumented as replay breadcrumbs; **only first-party (same-origin) or allowlisted origins** promote failed requests to error events — see [Failed HTTP / network requests](#failed-http--network-requests--events).

## Install

```bash
npm install @newtalaria/browser
```

From this monorepo:

```bash
cd new_talaria_js/packages/browser
npm install
npm run build
```

## Quick start

```ts
import { Talaria } from '@newtalaria/browser';

Talaria.init({
  // Serverpod base URL (no trailing path)
  dsn: 'http://localhost:8080',
  apiKey: 'tal_live_…', // public client key from Project settings → Client keys
  environment: 'development',
  release: '1.0.0',
  // Continuous session upload (0–1). Default 0 = buffer only until an error.
  replaysSessionSampleRate: 0,
  // On error, promote the ~60s ring buffer (0–1). Default 1.
  replaysOnErrorSampleRate: 1,
  // Post-error upload window. Default 15000 (cheap clip). Use 0 to continue
  // until the 5-minute max duration (Sentry-like, more expensive).
  replaysErrorAfterMs: 15_000,
  maskAllInputs: true, // default
  // Embed same-origin CSS into the snapshot (needed for auth-gated UIs like CMS).
  // Default false — player re-fetches public stylesheet hrefs instead.
  // inlineStylesheet: true,
});

try {
  throw new Error('Something broke');
} catch (error) {
  await Talaria.captureException(error);
}

await Talaria.captureMessage('Checkout opened', 'info');
console.log('replay', Talaria.getReplayId());

await Talaria.flush();
await Talaria.close();
```

`Talaria.init` also installs `window.onerror` / `unhandledrejection` handlers unless you pass `disableDefaultIntegrations: true`. Opaque cross-origin `"Script error."` events (no usable `Error` object) are ignored by default. Errors from browser extensions (`chrome-extension://`, `moz-extension://`, etc.) are also ignored.

Every ingested event includes browser runtime tags (`browser.name`, `browser.version`, `os.name`, `os.version`, `device`) and `extra.browser` / `extra.sdk` for triage.

Optional init `tags` are merged into every captured event (per-call tags win on key conflict).

### Tags (low-cardinality dimensions)

Use **tags** for dimensions you will filter/group on (`feature`, `operation`, `service`, …). Put diagnostic fields (`business_id`, request payloads) in `extra` / capture context — not tags.

```ts
Talaria.init({
  dsn: '…',
  apiKey: '…',
  environment: 'production',
  tags: { service: 'admin-web', platform: 'web' },
});

const checkout = Talaria.withTags({
  feature: 'checkout',
  operation: 'pay',
});
await checkout.captureMessage('Payment started', 'info');
await checkout.captureException(err, {
  tags: { component: 'stripe' }, // merges on top of withTags
  extra: { cart_id: 'abc123' },  // high-cardinality → extra
});
```

**Merge order (later wins):** automatic browser tags → init `tags` → `withTags` scope → per-call `context.tags`.

**Limits:** max 20 tags, key ≤64 (`[a-z0-9_.-]`), value ≤128, ~2KB total. Invalid keys are dropped. In non-production, high-cardinality-looking keys/values log a console warning.

Do **not** put `environment` / `release` in tags — use the first-class init fields.

`environment` must resolve to a wire value: `production` | `staging` | `development`. Common aliases are accepted (`test`/`uat` → `staging`, `prod`/`live` → `production`, `dev`/`local` → `development`), matching the PHP SDK. Invalid values throw at `init`. Permanent `events/ingest` 4xx responses disable further capture for that page session so misconfig cannot spin forever.

## Script tag (IIFE)

For hosts without a bundler (e.g. Silverstripe `Requirements`):

```html
<script src="/path/to/talaria.browser.iife.js"></script>
<script>
  Talaria.init({
    dsn: 'https://api.example.com',
    apiKey: 'tal_live_…',
    environment: 'production',
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
  });
</script>
```

Build output: `dist/talaria.browser.iife.js` (also produced by `npm run build` / `npm run build:iife`).

## Recommended sampling (cost)

You pay for **uploaded + retained** bytes, not for local buffering. Prefer error clips in production; keep full-session sampling low.

| Traffic | `replaysSessionSampleRate` | `replaysOnErrorSampleRate` | `replaysErrorAfterMs` |
| --- | --- | --- | --- |
| High (100k+/day) | `0.01` | `1.0` | `15000` (default clip) |
| Medium (10k–100k/day) | `0.1` | `1.0` | `15000` |
| Low (under 10k/day) | `0.25` | `1.0` | `15000` |
| Marketing / docs site | `0` | `1.0` | `15000` |
| Rich post-error context | `0` | `1.0` | `0` (continue to 5 min cap) |

**Defaults (`session=0`, `onError=1`, `errorAfterMs=15000`)** are the cheapest useful profile: quiet traffic costs nothing; each sampled error keeps ~60s before + ~15s after.

## Replay sampling behavior

| Mode | Behavior |
| --- | --- |
| Session sample hit | `replays/start` immediately; segments upload every ~5s or ~100KB until unload or **5 min** max |
| Session sample miss | Record into a ~60s ring buffer with a FullSnapshot checkout every ~60s; nothing uploaded until an error sample hits |
| Tab hidden → visible / bfcache restore | Take a checkout FullSnapshot (background timers are throttled; refreshes the paint base so error clips still have lead-up) |
| Error sample + `replaysErrorAfterMs > 0` | Upload buffer (≤~960KiB gzip pack target / **1MiB** server cap) + trailing window, hard caps **12 segments** or **2MiB** compressed, attach `replayId` only if segments landed, `finish`, return to buffer mode |
| Error sample + `replaysErrorAfterMs = 0` | Upload buffer then continue like session mode until **5 min** / unload / size caps |
| Server limit (replay segments / total size / duration) | Stop uploading that replay; no retries |
| Oversized FullSnapshot on segment 0 | **Abort** the clip (no blank orphan upload); error event gets `replay.capture=failed` + reason. Meta+FullSnapshot are taken/fitted **atomically** so a soft estimated take window cannot orphan the snapshot. |
| Oversized single non-FS rrweb event | Dropped with a console warning (cannot fit under segment cap) |
| `pagehide` / `close` | Flush pending segments with `fetch` `keepalive`, then `replays/finish`; `close` fully resets so `init()` works again (React Strict Mode) |

### Replay capture outcome tags

When an **error/fatal** event attempts an on-error clip (`replaysSessionSampleRate` miss), the SDK may attach:

| Tag | Values |
| --- | --- |
| `replay.capture` | `ok` \| `failed` \| `skipped` |
| `replay.capture_reason` | `oversized_full_snapshot` \| `no_full_snapshot` \| `upload_failed` \| `not_sampled` \| `buffer_empty` |

Failed captures do **not** set `replayId` (avoids linking a blank player). Details are also under `extra.replayCapture`.

When the paint base cannot ship, `extra.replayCapture` also includes size diagnostics where available:

| Field | Meaning |
| --- | --- |
| `fullSnapshotEstimatedBytes` | JSON size estimate of the FullSnapshot |
| `fullSnapshotCompressedBytes` | Gzip size of the FullSnapshot alone (when measured) |
| `metaEstimatedBytes` | JSON size estimate of the Meta event |
| `maxUncompressedSegmentBytes` / `maxCompressedSegmentBytes` | Current pack caps |

Use these to see how far over budget a CMS/admin snapshot was when a clip was aborted.

## Serverpod URL pattern

Talaria uses **Serverpod RPC**, not REST resource URLs:

| Call | Method | URL |
| --- | --- | --- |
| Start replay | `POST` | `{baseUrl}/replays/start` |
| Upload segment | `POST` | `{baseUrl}/replays/ingestSegment` |
| Finish replay | `POST` | `{baseUrl}/replays/finish` |
| Ingest event | `POST` | `{baseUrl}/events/ingest` |

Local default: `http://localhost:8080`.

Bodies are JSON with named parameters and `__className__` on typed inputs:

```json
{
  "input": {
    "__className__": "StartReplayInput",
    "replayId": "…",
    "environment": "development",
    "sessionId": "…",
    "url": "http://localhost:5173/"
  }
}
```

Auth (ingest):

- `X-API-Key: tal_live_…` (preferred)
- or `Authorization: Bearer tal_live_…`

### ByteData (`gzipBytes`)

Serverpod serializes `ByteData` as a wrapped base64 string:

```text
decode('<base64>', 'base64')
```

Segment payloads are a **gzip-compressed JSON array** of rrweb events.

Custom rrweb events:

- `talaria-console` — console level + message/args (truncated)
- `talaria-network` — method, sanitized URL (no query by default), status, duration, failure metadata (no bodies / no auth headers)

Privacy defaults: `maskAllInputs: true`, password fields masked, `[data-talaria-mask]` blocked.

### Auth-gated CSS (CMS / admin)

By default `inlineStylesheet` is `false`: linked stylesheets stay as `href`s and are re-fetched when you watch the replay. That works for **public** CSS, but fails for login-protected admin CSS (player has no session cookies).

Set `inlineStylesheet: true` so same-origin stylesheet rules are embedded while the user is logged in. Cross-origin sheets without CORS still cannot be inlined (browser `cssRules` restriction).

### Failed HTTP / network requests → events

All instrumented `fetch` / XHR calls are recorded as replay breadcrumbs (`talaria-network`). **Error events are promoted only for first-party (same-origin) or explicitly allowlisted origins.**

| Request | HTTP 5xx | Transport failure / timeout | Abort |
| --- | --- | --- | --- |
| Same-origin | Error event | Error event | Breadcrumb only |
| Allowlisted third-party (`networkErrorOrigins`) | Error event | Error event | Breadcrumb only |
| Other third-party (analytics, ads, widgets, …) | Breadcrumb only | Breadcrumb only | Breadcrumb only |

This avoids Issue spam from Google Analytics, ad pixels, privacy blockers, and similar third-party noise—without a hardcoded domain denylist. Add origins you intentionally depend on (payments, CMS APIs, widgets):

```ts
networkErrorOrigins: ['https://api.stripe.com', 'https://widget.yonder.example'],
// Escape hatch (not recommended): networkErrorOrigins: ['*']
```

**URL privacy:** network telemetry stores `origin + pathname` only (plus `hostname` / `pathname`). Query strings and fragments are stripped by default. Set `captureRequestQueryParameters: true` to keep query params after redaction of secrets **and** common tracking keys (`token`, `api_key`, `gclid`, `fbclid`, `_ga`, `cid`, `sid`, …). Bodies and auth headers are never captured.

Both **`fetch`** and **`XMLHttpRequest`** are instrumented (`network.transport`: `fetch` | `xhr`). Failure kinds are only claimed when detectable:

| `failure.kind` | Meaning |
| --- | --- |
| `http` | Completed response with a real status (e.g. 500) |
| `network` | No usable HTTP response (status 0 / Failed to fetch) — CORS, block, DNS, offline, etc. |
| `timeout` | `TimeoutError` or XHR `timeout` event |
| `abort` | `AbortError` / XHR abort — recorded in breadcrumbs, **not** promoted as events |

We **do not** classify status 0 as `cors` — browsers do not expose that reliably. Tags include `network.party` (`first_party` \| `third_party`).

Promoted events use structured `extra` (server groups on method + host + path + kind + status) plus a first-class `exception` with synthetic type `HttpError` | `NetworkError` | `TimeoutError`:

```json
{
  "http": {
    "method": "POST",
    "url": "https://app.example.com/api/orders",
    "origin": "https://app.example.com",
    "hostname": "app.example.com",
    "pathname": "/api/orders",
    "transport": "fetch"
  },
  "failure": { "kind": "network", "name": "TypeError", "message": "Failed to fetch" },
  "network": { "party": "first_party", "durationMs": 842, "aborted": false, "ok": false },
  "status_code": null
}
```

Wire `exception` (not `extra`):

```json
{
  "values": [
    {
      "type": "NetworkError",
      "value": "Network error: GET https://app.example.com/api/orders — TypeError: Failed to fetch",
      "mechanism": { "type": "http", "handled": true, "synthetic": true }
    }
  ]
}
```

Crawler UAs are tagged (`bot=true`, `bot.name=Baiduspider`) without inventing a browser name.

```ts
Talaria.init({
  dsn: 'https://api.example.com',
  apiKey: 'tal_live_…',
  environment: 'production',
  // Default true — HTTP status promotion (first-party / allowlisted only)
  captureFailedRequests: true,
  // Default true — transport failures (first-party / allowlisted only)
  captureNetworkErrors: true,
  // Extra origins to treat like first-party for promotion
  networkErrorOrigins: ['https://api.stripe.com'],
  // Default false — do not store ?query on network URLs
  captureRequestQueryParameters: false,
  // Default [[500, 599]]. CMS admin often wants 4xx too:
  failedRequestStatusCodes: [[400, 599]],
  // Extra URL substrings to skip (Talaria /events and /replays are always skipped)
  failedRequestIgnoreUrls: ['/health'],
});
```

`AbortError` is never promoted and is ignored by the global `unhandledrejection` handler. Bare `TypeError: Failed to fetch` / `TimeoutError` rejections are correlated with recent network breadcrumbs: promoted failures and third-party noise are suppressed; first-party failures with promotion off keep the exception and merge request context.

#### Network event tags (low cardinality)

| Tag | Values | Notes |
| --- | --- | --- |
| `http.method` | `GET`, `POST`, … | |
| `http.status_code` | e.g. `500` | Present on HTTP promotions only |
| `network.failure_kind` | `http` \| `network` \| `timeout` | |
| `network.transport` | `fetch` \| `xhr` | |
| `network.party` | `first_party` \| `third_party` | Same-origin vs cross-origin (allowlist does not change this tag) |
| `network.error_name` | e.g. `TypeError`, `TimeoutError` | When available |

Hostname, pathname, full sanitized URL, and duration live in `extra` — not tags — to avoid high-cardinality facets.

#### Issue grouping (server)

Promoted network events set first-class `exception.values[0].type` (`HttpError` \| `NetworkError` \| `TimeoutError`) and `extra.status_code`. The server fingerprints them on **method + hostname + pathname + failure kind + status** (not the human message), so query strings and volatile error text do not fragment Issues. See [`planning/fingerprints.md`](../../../planning/fingerprints.md) §6.4.

### Exceptions and stack frames

`captureException` sends:

| Field | Meaning |
| --- | --- |
| `platform` | Always `javascript` |
| `stackTrace` | Raw `Error.stack` string (kept for compatibility) |
| `exception.values[0]` | `type` = `err.name`, `value` = `err.message`, parsed `stacktrace.frames` (oldest → newest), `mechanism` |

Frames use wire field `functionName` (not `function`). `inApp` is **true** for same-origin frames (and `inAppOrigins` / `inAppAllowUrls`); **false** for cross-origin CDN/third-party scripts, `@newtalaria/browser`, `node_modules`, browser extensions, and `inAppDenyUrls`.

Global handlers set `mechanism.type` to `onerror` / `unhandledrejection` (`handled: false`). Manual captures default to `generic` (`handled: true`). Do **not** put `exception_class`, `file`, `line`, or `code` in `extra` — those belong on the exception / frame payload.

### Event timestamps

| Field | Meaning |
| --- | --- |
| `timestamp` | **Occurrence time** on the client (when capture began — before replay flush) |
| `createdAt` | **Ingest/storage time** on the server |

If replay upload runs before event ingest, `extra.sdk.queuedMs` records how long capture waited (ms). A large `createdAt - timestamp` gap is usually flush/queue delay or clock skew — not a wrong failure classification.

## Init options reference

| Option | Default | Description |
| --- | --- | --- |
| `dsn` / `baseUrl` | *(required)* | Serverpod host, e.g. `https://api.example.com` |
| `apiKey` | *(required)* | Public client key (`tal_live_…`). Safe to embed; configure allowed domains in the dashboard for production. |
| `environment` | *(required)* | `production` \| `staging` \| `development` (aliases accepted) |
| `release` | — | Optional release string on every event |
| `userId` | — | Optional app user id |
| `tags` | — | Tags merged into every event |
| `replaysSessionSampleRate` | `0` | Fraction of sessions that upload continuously |
| `replaysOnErrorSampleRate` | `1` | Fraction of errors that promote the ring buffer |
| `replaysErrorAfterMs` | `15000` | Post-error upload window; `0` = continue to 5 min cap |
| `maskAllInputs` | `true` | rrweb input masking |
| `inlineStylesheet` | `false` | Embed same-origin CSS (CMS/admin) |
| `blockSelector` | — | Extra CSS selectors blocked from the DOM snapshot |
| `disableDefaultIntegrations` | `false` | Skip `window.onerror` / `unhandledrejection` |
| `captureFailedRequests` | `true` | Promote HTTP status failures (**first-party / allowlisted only**) |
| `captureNetworkErrors` | `true` | Promote transport/timeout failures (**first-party / allowlisted only**) |
| `networkErrorOrigins` | `[]` | Extra origins eligible for promotion; same-origin always eligible; `['*']` = all (not recommended) |
| `failedRequestStatusCodes` | `[[500, 599]]` | Status codes/ranges to promote when origin is eligible |
| `failedRequestIgnoreUrls` | `[]` | URL substrings never promoted (Talaria `/events` + `/replays` always ignored) |
| `captureRequestQueryParameters` | `false` | Keep `?query` on network URLs after redaction (`includeNetworkUrlQuery` alias) |
| `inAppOrigins` | `[]` | Extra origins treated as app code for stack `inApp` (exact origin strings; same-origin always included) |
| `inAppAllowUrls` | `[]` | Path substrings or RegExps that force `inApp: true` |
| `inAppDenyUrls` | `[]` | Path substrings or RegExps that force `inApp: false` |

## Public API

| API | Description |
| --- | --- |
| `Talaria.init(options)` | Configure + start recording + install network/console hooks |
| `Talaria.captureException(error)` | Ingest error (+ replay link when sampled) |
| `Talaria.captureMessage(message, level?)` | Ingest message |
| `Talaria.getReplayId()` | Active upload replay id, or `null` |
| `Talaria.flush()` | Upload buffered segments |
| `Talaria.close()` | Stop recording, flush, finish |

## Example

See [`../../examples/sdk-spa`](../../examples/sdk-spa) for a minimal page wired to `localhost:8080`.

## Local `file:` install (marketing / monorepo)

`dist/` is gitignored. After editing SDK `src/`, rebuild before the consumer picks up changes:

```bash
cd new_talaria_js/packages/browser
npm run build
# or: npm install in the consumer — `prepare` runs build for file: installs
```

Then restart the Next app with a clean cache:

```bash
cd ../new_talaria_marketing   # sibling repo
rm -rf .next
npm run dev
```

**Serverpod must be restarted** after changing `ReplayLimits` (compressed cap is 512KiB). A live process still on 256KiB will 400 every near-max segment.

### Verify error-clip ingest

1. Restart Serverpod (512KiB live).
2. Rebuild the browser package; restart marketing with clean `.next`.
3. Browse `/docs/**` ~30s, throw one test exception.
4. Expect: a few `ingestSegment` 200s, one `finish`, **zero** compressed-size 400 spam, dashboard replay plays.
5. Throw again later: a new bounded clip is allowed (buffer mode reset).
