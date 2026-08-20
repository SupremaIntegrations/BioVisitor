---
name: BioStar device capability detection
description: How to correctly detect face/fingerprint/card capabilities for BioStar devices; pitfalls with the capability API endpoint and Redis key prefix.
---

# BioStar Device Capability Detection

**Why:** `POST /api/devices/capability` with `{ DeviceCollection: { rows: [{ id }] } }` body returns `rows: []` (empty) — BioStar ignores the filter. `GET /api/devices` also omits `type_id.name` in this server's build, so all devices show as "Desconocido". The old keyword approach (e.g., matching "BioStation") matched both "BioStation 3" (face) and "BioStation L2" (no face).

## Correct approach (implemented in `enroller-devices.service.ts`)

### 3-strategy cascade
1. **`GET /api/devices/{id}`** — single device endpoint, richest data. Use `deepFindBool()` for explicit face/fingerprint flags; if not found, fall back to name-based map.
2. **`POST /api/devices/capability` with empty body `{}`** — returns all devices' capabilities; filter by id in response rows.
3. **`listDevices` + type name map** — always available, uses cached device list.

### Model name extraction
Since `type_id.name` is absent, the **device name itself** contains the model prefix:
- `"BioStation 3 538155116 (192.168.10.10)"` → `startsWith("biostation 3")` → `face=true, fingerprint=true`
- `"FaceStation F2 543721717 (192.168.10.9)"` → `startsWith("facestation f2")` → `face=true, fingerprint=false`
- `"BioStation L2 540132614 (192.168.10.1)"` → `startsWith("biostation l2")` → `face=false, fingerprint=true`

**How to apply:** When `typeName === "Desconocido"` or empty, pass `deviceName` to `getCapFromTypeName()` instead.

### `DEVICE_CAP_MAP` order matters
Map entries must go from **most specific to least specific** prefix. "biostation 3" must come before "biostation" or "BioStation L2" before "BioStation" — otherwise the catch-all matches first.

## Redis key prefix gotcha

The ioredis client is configured with `keyPrefix: "bv:"` in `env.config.ts`. This means:
- Code writes `bv:devcap:...` → actual Redis key is **`bv:bv:devcap:...`**
- `redis-cli KEYS "bv:devcap:*"` finds NOTHING (wrong prefix)
- **Always clear cache with:** `redis-cli DEL "bv:bv:devcap:{tenantId}:{deviceId}"`
- Same applies to `bv:devices:*` → actual key `bv:bv:devices:*`

This double-prefix is consistent across the codebase (all `bv:*` keys in the service have this). Do not "fix" it — it would invalidate all existing cached data.

## Verified capabilities (prod environment)
| Device | ID | face | fingerprint | card |
|---|---|---|---|---|
| BioStation 3 | 538155116 | true | true | true |
| FaceStation F2 | 543721717 | true | false | true |
| BioStation L2 | 540132614 | false | true | true |
