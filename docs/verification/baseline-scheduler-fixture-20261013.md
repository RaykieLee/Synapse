# Baseline scheduler fixture repair

## Finding

The F18b2b baseline failure was fixture interference, not a product defect in
`app.tasks.scheduler_state`.

`claim_due_tasks(..., limit=1)` orders all due rows by slot and task ID. During
the real two-session race, the losing session can observe the first row after
the winner commits and then claim the next due row. The original verification
fixture left `lease slot`, `success slot`, `failure slot`, and the invalidation
fixtures due at the same timestamp as `concurrent slot`. That allowed the race
worker to consume `lease slot`; the later lease phase then raised
`StopIteration` while looking for its expected unclaimed slot.

## Repair

`test_f18b2b_scheduler_claims.py` now isolates each lifecycle phase by moving
unrelated, unclaimed schedule states one day into the future. The concurrent
phase still uses two independent SQLAlchemy sessions and `limit=1`; the lease
phase still reclaims the same slot and checks stale-token rejection; later
phases retain their success, failure, retry, invalidation, and persistence
assertions.

Claimed rows are not rewritten by the helper, so the durable concurrent lease
remains available for the final restart assertion.

## Evidence

- Before the fixture repair, the parent ran the default suite and observed
  `1 failed, 48 passed, 26 deselected`: `StopIteration` at the lease-phase
  `next(... "lease slot")` lookup. The independent isolated attempts did not
  reproduce it; the two-session race could consume another due fixture row.
- After the repair, the focused test passed for 10 consecutive isolated runs.
- The focused test plus the scheduler runtime and scheduled-task-run
  verification tests passed: `1 passed, 2 deselected`.
- `git diff --check` passed after the repair.

The runs emitted only the existing Alembic `path_separator` deprecation
warnings. No product file was modified.
