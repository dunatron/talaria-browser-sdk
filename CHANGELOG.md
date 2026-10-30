# Changelog

## 0.2.0

- **Breaking:** Ingest uses REST `/v1/*` on the ingest host (`POST /v1/events`, `/v1/spans`, `/v1/replays`, `/v1/replays/segments`, `/v1/replays/{id}/finish`). Serverpod RPC paths (`events/ingest`, `spans/ingestBatch`, `replays/*`) are removed with no fallback.
- Wire bodies are plain JSON batch envelopes; byte fields (replay `gzipBytes`) are standard base64. Auth stays `X-API-Key`.
- Ingest errors prefer RFC 9457 `application/problem+json` (`code`, `detail`).

## 0.1.25

- Disable event, span, and replay ingest for this page after a permanent client error (`retry: false` / invalid API key). Quota and 5xx keep sending.
- Align `SDK_VERSION` with the published package version.
