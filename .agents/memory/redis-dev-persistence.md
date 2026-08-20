---
name: Redis dev persistence across workflow restarts
description: Why Redis-backed settings (exit devices, enrollers, per-tenant config) can silently vanish when the app workflow restarts, and how it's mitigated
---

`start.sh` launches `redis-server --daemonize yes` fresh on every workflow start. Without an explicit `--dir`/`--dbfilename`/`--save`, the RDB snapshot either isn't written or isn't reloaded from a stable path, so every Redis-backed setting (exit devices, enrollers, QR settings, autocheckout config, session caches — see `per-tenant-settings-pattern.md`) is wiped on each restart.

**Why:** This caused real confusion during debugging — a working device/config set up by the user got silently erased after the agent restarted the workflow to test a code fix, making it look like the fix "didn't work" when actually the config was just gone.

**How to apply:** `start.sh` now starts redis with `--dir <project>/.redis-data --dbfilename dump.rdb --save 30 1 --save 300 10`, so data survives restarts (verified: set key, restart workflow, key persists). If you ever touch `start.sh`'s redis invocation, preserve these flags. When debugging "a setting disappeared" reports, always check whether Redis persistence regressed before assuming application logic is at fault.
