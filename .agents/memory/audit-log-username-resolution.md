---
name: Audit log userName resolution
description: How the audit trail's "Quién" (Who) column resolves human-readable names instead of raw UUIDs.
---

`userName` in `audit_logs` is resolved automatically in two places, not manually at each call site:

1. **Write-time**: `StructuredLoggerService.log()` (`biovisitor-backend/src/core/logging/structured-logger.service.ts`) looks up the `User` repo by `userId` and fills `userName` before inserting, whenever a caller of `logUserAction`/`logAuditEvent` omits it.
2. **Read-time fallback**: `AuditService.findAll()` (`biovisitor-backend/src/modules/audit/audit.service.ts`) enriches any historical rows that still have a null `userName` by batch-looking-up missing `userId`s against the `User` table, so old rows self-heal in the UI without a DB backfill migration.

**Why:** There were ~40 call sites of `logUserAction` across the codebase, most of which never passed the optional `userName` param, causing the frontend audit trail to show raw UUIDs in the "Quién" column instead of a name. Patching each call site individually would be fragile and easy to regress; centralizing resolution guarantees correctness for both new and legacy data.

**How to apply:** When adding a new audit/user-action log call, it's fine to omit `userName` — it will be resolved automatically as long as a valid `userId` (UUID) is passed. No need to fetch the user manually before logging.
