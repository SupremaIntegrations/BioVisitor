---
name: BioStar WebSocket event field shapes
description: How to extract user_id and device_id from BioStar 2/X real-time WS ACCESS_GRANTED events.
---

## Field shapes
- `user_id` on a WS event can be either a plain string OR a nested object `{ user_id: string, ... }` (mirrors the shape used by the BioStar2/BioStarX REST clients). Always check `event.user_id?.user_id` before falling back to `event.user_id`.
- `device_id` can likewise be a nested object `{ id, name }` or a raw string/number depending on event source; extract with `event.device_id?.id?.toString() ?? String(event.device_id)`.
- Some events are wrapped one level deeper under `event.EventLog.*` — check both the top-level and `EventLog`-nested paths.

**Why:** BioStar's WS event payload shape isn't consistently documented and varies between BioStar 2 and BioStar X; assuming a single flat shape silently breaks event-driven features (e.g. QR burn-after-use, auto-checkout-on-exit-device).

**How to apply:** Any new feature reacting to BioStar WS events (in `biostar-ws.service.ts`) must extract `user_id`/`device_id` using the multi-shape fallback chain above, not a single direct property access.
