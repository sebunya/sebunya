# Server-Side Google Tag Manager (sGTM) Security and Deduplication

This document details the security and replay protection controls applied to the server-side Google Tag Manager (sGTM) integration in GoldPlus Commerce OS.

---

## 1. Payload Signing (HMAC-SHA256)
Outbound events dispatched to the sGTM container are signed to verify authenticity and prevent spoofing:
- **HMAC Signature**: The `TelemetryDispatchService.ts` computes an HMAC-SHA256 hash of the JSON payload string using a shared secret (`GTM_SECRET`).
- **Signature Header**: The signature is attached as the `X-Signature` header.
- **Verification**: The sGTM container validates this signature before processing or forwarding events to Google Analytics, Meta CAPI, or other marketing sinks.

---

## 2. Replay & Duplicate Prevention
To prevent duplicate conversions from network retries, browser reload events, or double webhook hits:
- **Cache Registry**: A lightweight in-memory cache tracks `event_id` values in `botDetection.ts` middleware.
- **TTL Eviction**: The cache keeps `event_id` entries for 10 minutes to cover standard client retry window limits.
- **Deduplication Rule**: If a request arrives with an `event_id` that is already in the cache, the middleware blocks it with a `400 Bad Request` or skips it with a warning log, ensuring only unique actions generate marketing pixel reports.

---

## 3. Match Signal Telemetry
To monitor conversion matches in real-time, the system registers two telemetry gauges:
- **`goldplus_gtm_dispatch_latency_seconds`**: Tracks network roundtrip latencies to the sGTM proxy.
- **`goldplus_gtm_event_match_score`**: Records the identity score (from 0 to 100) based on user parameter density.
