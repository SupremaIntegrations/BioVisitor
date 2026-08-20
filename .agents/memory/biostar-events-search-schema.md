---
name: BioStar POST /api/events/search payload schema
description: Correct request shape for querying historical BioStar 2/X access events by date range.
---

## Correct schema
A datetime range filter is ONE condition with BOTH bounds in the same `values` array, using `operator: 3`:

```json
{
  "Query": {
    "limit": 1000,
    "conditions": [
      { "column": "datetime", "operator": 3, "values": ["FROM_ISO_UTC", "TO_ISO_UTC"] }
    ],
    "orders": [{ "column": "datetime", "descending": true }]
  }
}
```

**Why:** Two separate conditions (`operator: 3` for `>=` fromDate, `operator: 5` for `<=` toDate) looks like the natural REST-filter pattern, but BioStar silently returns HTTP 200 with zero rows for that shape — no error, so the bug is easy to miss and hard to diagnose. The single-condition/two-values "between" form is what BioStar actually expects.

**How to apply:** Any code calling `POST /api/events/search` (event history polling, audit/history endpoints, exit-device auto-checkout detection) must use the single-condition two-value form above. If a `/api/events/search` call ever returns 200 with an empty array despite known events existing in the window, check this schema first before suspecting timezone/auth/LAN-restriction issues.

## `datetime` vs `server_datetime` fields
Each event row has both a `datetime` and a `server_datetime` field, and they are NOT interchangeable:
- `datetime` was empirically verified to be true UTC and matches real current time (an event's `datetime` was ~4 minutes before the request time when queried immediately after).
- `server_datetime` on this deployment (BioStar server in Colombia, UTC-5) was offset by ~5 hours behind `datetime` — it appears to be the server's local wall-clock time mislabeled with a "Z"/UTC suffix.

**Why:** filtering/comparing against the wrong field silently breaks time-window queries (e.g. an exit-device polling window built from `new Date()`, which is true UTC, will never match rows if you filter or compare using the mislabeled `server_datetime`).

**How to apply:** always filter and order `/api/events/search` queries by `datetime`, and compare against `fromDate.toISOString()`/`toDate.toISOString()` (true UTC). Do not use `server_datetime` for filtering or freshness comparisons on this deployment. If moving to a different BioStar server, re-verify which field is actually true UTC before trusting either — don't assume field naming reflects behavior.

## Determining "access granted" from an event row (`is_dst` is NOT it)
Event rows have an `is_dst` field that looks like it could mean "granted/denied" if you don't check its actual value, but it does not indicate that at all:
- It comes back as the **string** `"0"` (not a boolean or number), so a `=== 0` comparison is always false regardless of intent.
- Empirically, `is_dst` was `"0"` on every single row — device system events AND real user authentication events alike. It carries no granted/denied signal at all (name suggests it's a daylight-saving-time flag).

The actual "access granted" signal is `event_type_id.code`, and it spans **two** separate code families depending on the authentication mode — checking only one silently misses the other:
- `0x1300`–`0x13FF` (mainCode `0x13`): **IDENTIFY_SUCCESS** (1:N matching, e.g. face/fingerprint scanned without first presenting an ID). Confirmed with a real FaceStation F2 authentication returning code `4867` (`0x1303`).
- `0x1000`–`0x10FF` (mainCode `0x10`): **VERIFY_SUCCESS** (1:1 matching, e.g. an RFID/QR card that already carries the ID and is just verified). Confirmed with 3 real card swipes on a BioStation 3 exit device returning code `4102` (`0x1006`).

Denied/failed equivalents live in `0x1400`–`0x14FF` (VERIFY_FAIL) and `0x1500`–`0x15FF` (IDENTIFY_FAIL) — do not include these.

**Why:** This caused two real production bugs on the same feature. First, the auto-checkout-by-exit-device feature never fired because `isGranted` was always `false` under the `is_dst === 0` check. After fixing that to check `0x13`, it broke again for card-based exit devices specifically — because card verification events land in the `0x10` family, not `0x13`, and only `0x13` was checked.

**How to apply:** in any code that classifies BioStar event rows as granted/denied (exit-device auto-checkout, access history, live event feed), compute granted status as `mainCode === 0x13 || mainCode === 0x10` (never from `is_dst`). If a specific credential/device type reports granted events outside both ranges in the future, re-verify empirically rather than assuming the two known ranges are exhaustive.
