---
name: Deferred/delayed action re-check pattern
description: When an action is scheduled with setTimeout based on an event, always re-fetch and re-validate state right before executing, not just at scheduling time.
---

When a feature schedules a state-changing action after a configurable delay (e.g. `setTimeout(() => doAction(), delaySeconds * 1000)`) in reaction to an external event, capture only the entity ID at schedule time — then re-fetch the entity fresh and re-validate its current status immediately before executing the action.

**Why:** the entity's state can change during the delay window (e.g. someone manually completes the action, or it's already been processed by another path), so acting on the stale snapshot causes race conditions like double-processing or overwriting a newer state.

**How to apply:** any delayed/debounced background action triggered by webhooks, device events, or queues (not just checkout flows) — always re-check the guard condition (status, flag) right before the actual mutation, not just when the timer was scheduled.
