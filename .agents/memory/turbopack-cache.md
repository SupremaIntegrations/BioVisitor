---
name: Turbopack cache corruption & race condition
description: Stale .next cache causes Turbopack to accept TCP connections silently but never send HTTP responses; backend startup race condition causes proxy errors on first load.
---

# Turbopack Cache Corruption & Startup Race Condition

## The Rule
When Next.js 16 + Turbopack accepts TCP connections on port 5000 but never sends any HTTP response (curl hangs, no logs, even static assets hang), the `.next` cache is corrupted. Delete it and restart.

**Why:** Turbopack's incremental cache can enter a broken state after abrupt workflow terminations. The server starts fine ("Ready in Xms") but the request handler is deadlocked internally waiting on a stale compilation artifact.

**How to apply:** If preview is blank and all curl/wget requests to port 5000 time out after the server reports "Ready":
```bash
rm -rf biovisitor-frontend/.next
# then restart workflow
```

## Backend Startup Race Condition
Next.js starts and compiles the page faster than NestJS initializes. On first browser request, Next.js tries to proxy `/api/v1/auth/system-status` → `localhost:3001` → ECONNREFUSED.

**Fix applied:** `start.sh` sleep between backend start and frontend start raised from 5s → 15s. NestJS takes ~18s to fully initialize in dev mode; with 15s head start it's usually ready before the first real browser request arrives.

**Symptom in logs:**
```
Failed to proxy http://localhost:3001/api/v1/auth/system-status Error: connect ECONNREFUSED 127.0.0.1:3001
```
This is a transient error on cold start, not a code bug.
