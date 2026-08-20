---
name: Per-tenant settings pattern
description: Convention for admin-configurable, tenant-scoped settings in BioVisitor X (auto-checkout, auto-print, visitor types, etc).
---

Admin-configurable settings that vary per tenant (auto-checkout config, auto-print
toggle, visitor-type auto-checkout defaults, custom visitor types, etc.) are stored
directly in Redis under a key namespaced by tenant, e.g. `{feature}:{tenantId}`, with
a NestJS service exposing `get*()`/`save*()` methods and a controller endpoint under
`/visitors/settings/*`.

**Why:** This was the pattern already established by `AutoCheckoutService` before this
feature was added, and keeps settings lightweight (no migrations, no new tables) for
config that doesn't need relational queries or history.

**How to apply:** When adding a new admin setting, check `AutoCheckoutService` first
for the get/save/merge conventions (including "replace vs merge" semantics for
dictionary-shaped settings) before introducing a new table or a different storage
mechanism.
