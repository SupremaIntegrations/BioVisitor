---
name: BioStar X user_group_id format
description: BioStar X requires user_group_id as an object {id, name}, never a string or integer. Confirmed by inspecting existing users via GET /api/users.
---

## Rule
When creating or updating users in BioStar X via `POST /api/users`, the `user_group_id` field MUST be an object `{"id": "1", "name": "All Users"}`, NOT a plain string ("1") or integer (1).

**Why:** BioStar X stores and returns `user_group_id` as an embedded object — confirmed by inspecting real users via GET /api/users. Sending a string/int causes HTTP 400 with code 600 "User Group doesn't exist." regardless of any other field combination. This is different from BioStar 2 which accepts a string ID.

**How to apply:**
- In `suprema-sync.service.ts`, the BioStar X `userPayloadMinimal` must include `user_group_id: { id: '1', name: 'All Users' }`.
- All fallback retry payloads must also use object format.
- "All Users" (id="1") is the ONLY user group in BioStar X — it's a virtual root group. Sub-groups cannot be created (POST /api/user_groups returns "Paret user group is empty" for any parent format).
- Use `permission: { id: '2' }` (User Operator) for standard non-admin users. Admins use id="1".
- BioStar X auth: session managed via `bs-session-id` header only (no CSRF token, no Set-Cookie). GET requests work the same as POST with the same headers.
