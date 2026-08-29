# Concurrent appends to the Msaidizi task-event chain fail non-deterministically

**Found:** 2026-08-29, from an intermittent CI failure in `Backend — E2E Smoke`.
**Status:** **FIXED** in migration `20260829120000_msaidizi_task_event_cursor_allocated_under_lock`.
Reproduced and verified against a real PostgreSQL 16: with the old trigger, 8
concurrent writers gave 4 successes and 4 failures; with the fix, 8 and then 24
concurrent writers all succeed on contiguous cursors, repeatedly. The migration's
`regression.sql` fails against the old trigger and passes against the new one.
**Severity:** fail-closed. Nothing is corrupted; legitimate writes are rejected.

---

## The symptom

`Verify append-only Msaidizi task-event hash chain` failed on one branch and
passed on another with identical code:

```
PostgresError code 23000:
  task event cursor 5 does not extend chain head 6
```

The error text is one the test *expects* elsewhere, which makes it easy to
misread as the test working. It is not: this instance escaped uncaught from
`scripts/test-msaidizi-task-event-integrity.mjs`, where two writers append
concurrently on purpose:

```js
await Promise.all([
  writerA.msaidiziTaskEvent.create({ ... }),
  writerB.msaidiziTaskEvent.create({ ... }),
]);
```

That is the right thing to test. The chain must survive concurrent appends,
because the task runtime writes events from concurrent steps.

## The cause

`database/prisma/migrations/20260825270000_msaidizi_task_event_integrity_chain/migration.sql`

```sql
-- A transaction-scoped global lock prevents two writers from both extending
-- the same head. Constants are private namespace identifiers, not secrets.
PERFORM pg_advisory_xact_lock(1297302865, 1414743382);

SELECT "cursor", "eventHash" INTO prior_cursor, prior_hash
FROM "msaidizi_task_events" ORDER BY "cursor" DESC LIMIT 1;

IF prior_cursor IS NOT NULL AND NEW."cursor" <= prior_cursor THEN
  RAISE EXCEPTION 'task event cursor % does not extend chain head %', ...
END IF;
```

The lock is real and it does serialize the *check*. But `cursor` is

```prisma
cursor BigInt @id @default(autoincrement())
```

a Postgres sequence, and a column default is evaluated **before** a
`BEFORE INSERT` trigger runs — therefore before the lock is taken. So the two
orderings are independent:

| | writer A | writer B |
|---|---|---|
| sequence | gets cursor **5** | gets cursor **6** |
| advisory lock | acquires **second** | acquires **first** |
| result | `5 <= 6` → **rejected** | appended, head = 6 |

Whichever writer draws the lower cursor but loses the race for the lock is
rejected, despite being a perfectly ordinary append. Which one that is depends
purely on scheduling, which is why it passes on an idle machine and fails on a
loaded CI runner.

The trigger's own comment states the intent exactly — "prevents two writers from
both extending the same head". The intent is right; the lock is simply in the
wrong place to achieve it, because the number it is defending was already handed
out.

## What it does and does not mean

- **No corruption.** The rejection is the chain refusing a non-extending write.
  Hash linkage, immutability and the append-only property all hold.
- **Legitimate writes are lost.** A concurrent task-event append can fail with
  what reads like an integrity violation. `ERRCODE = 'integrity_constraint_violation'`
  also tells a caller "you did something wrong", not "retry me", so a retry
  layer would not obviously be triggered by it.
- **It is load-dependent.** Expect it to appear more often in production under
  parallel task steps than it ever did in development.

## The shape of a fix

Not applied here, but recorded so the next person does not have to re-derive it.
Allocate the cursor **inside** the lock rather than trusting the sequence:

```sql
PERFORM pg_advisory_xact_lock(1297302865, 1414743382);
SELECT "cursor", "eventHash" INTO prior_cursor, prior_hash ...
NEW."cursor" := COALESCE(prior_cursor, 0) + 1;
```

That makes allocation and validation atomic with respect to each other. It needs
care on three points:

1. the sequence still advances, so it must not be relied on for identity;
2. `msaidizi_host_actions.journalEvidenceEventCursor` is a foreign key to
   `cursor`, so the column's meaning must not change;
3. existing rows must keep their hashes — this is an append-only ledger, so the
   migration must not rewrite history to "fix" it.

Alternatively, keep the sequence and make the exception retryable
(`ERRCODE = '40001'`) so callers back off and retry, which is the smaller change
but leaves a spurious failure in the hot path.

## What the fix does

The chosen option is the first one above: the cursor is assigned inside the
lock, so allocation and validation are atomic with respect to each other.

It carries one deliberate semantic change, which is why the option was not taken
without asking. Before, a caller-supplied cursor that did not extend the head was
*rejected*. Now it is *not honoured at all* — any insert lands at head + 1,
correctly linked. That is strictly stronger: a caller could previously choose a
position and be refused only for a bad choice, and can now not choose at all.
Forged history was impossible before and remains impossible; an attempt to insert
at an earlier position is appended honestly at the head rather than accepted.

The change was unavoidable rather than preferred. BIGSERIAL fires for every
insert, so the trigger genuinely cannot tell a caller-supplied value from a
sequence-supplied one — the honest concurrent writer and the backdating attacker
arrive looking identical. Rejecting one meant rejecting both.

The test that exposed it is correct and should stay as it is. It is currently
the only thing in the repository that appends to this chain concurrently, which
is why nothing else had noticed.
