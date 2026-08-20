---
name: Enroller Devices Architecture
description: How device enroller storage, BioStar device listing, and face capture from device work in BioVisitor X.
---

## Redis Key Patterns
- `enrollers:{tenantId}` — JSON array of EnrollerDevice objects (permanent, no TTL)
- `bv:devices:{tenantId}` — BioStar device list cache (5 min TTL)
- `bv:bsession:conn:{connId}` — BioStar session token per connection (25 min TTL)

## BioStar Session Flow (EnrollerDevicesService)
- Does NOT use SupremaGatewayService (which requires Tenant entity)
- Uses SupremaApiConnection entity directly from settings module
- Authenticates via POST /api/login, stores session in Redis
- Falls back from tenant-specific to global connection (tenantId=null)

## Device Capture Endpoint
- Primary: POST `{apiUrl}/api/devices/{deviceId}/monitoring/scan_picture` with `{"timeout": 30}`
- Fallback: POST `{apiUrl}/api/monitoring/scan_picture` with device_id in body
- Response: `{DeviceScanPicture: {picture: "base64...", quality: N}}`
- Returns `{imageBase64: string, quality?: number}`

**Why:** BioStar 2 endpoint varies slightly by version. Two-endpoint fallback covers older deployments.

## Frontend Device Mode (FaceCaptureModal)
- Tab toggle only visible when captureState === 'idle'
- When "Dispositivo Suprema" tab active: shows DevicePanel (no webcam)
- On successful device capture: sets capturedImage and switches to 'preview' state in webcam flow
- Countdown: 30 second timer via setInterval, clears on success/error/unmount

## Enroller Types
- `face` — Appears as option in FaceCaptureModal device tab
- `fingerprint` — For future fingerprint enrollment flows
- `card` — For future card/QR enrollment flows

## BioStar wsapi Requires Authenticated Session
The `/wsapi` WebSocket (used for live ACCESS_GRANTED events, e.g. exit-device auto-checkout) opens successfully even with NO authentication, but BioStar then silently never streams any events over it — no error, no close, just permanent silence.

**Why:** BioStar ties the wsapi event stream to a valid `bs-session-id`. A bare `wss://` connection (agent-only, no cookie) is accepted at the TCP/TLS/HTTP-upgrade level but isn't tied to any authenticated session, so the server has no session to attach event delivery to.

**How to apply:** Any service opening a BioStar wsapi socket must first obtain a `bs-session-id` via `POST {apiUrl}/api/login` (reuse cached session at `bv:bsession:conn:{connId}`, 25 min TTL, same key as above) and send it as `Cookie: bs-session-id=<id>` in the WS handshake headers. On `unexpected-response` with 401/403, invalidate the cached session so the next reconnect re-authenticates.

## BioStar event querying: only `POST /api/events/search` works
There is no `GET /api/events?device_id=...` endpoint in BioStar — it returns HTTP 400. The only working REST way to query access events (used as a polling fallback alongside the WS push, in case WS is LAN-restricted like `/api/monitoring/*`) is `POST /api/events/search` with a `Query.conditions` filter array (columns: `datetime` with operator 3/5 for >=/<=, `device_id` with operator 0 for =). Convention: `is_dst === 0` means access granted. This is the same endpoint/shape as `getEvents()` in `biostar2.client.ts`/`biostarx.client.ts` — always check those before adding new BioStar event-query code.
