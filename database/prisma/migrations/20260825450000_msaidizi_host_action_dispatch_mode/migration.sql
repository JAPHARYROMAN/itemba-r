-- Result settlement may bind only an execution-authorizing generation. A
-- replay-result token transports an already journaled receipt and is never
-- evidence that a host effect ran.
ALTER TABLE "msaidizi_host_action_dispatches"
  ADD COLUMN "executionMode" TEXT NOT NULL DEFAULT 'EXECUTE';

ALTER TABLE "msaidizi_host_action_dispatches"
  ADD CONSTRAINT "msaidizi_host_action_dispatches_executionMode_check"
  CHECK ("executionMode" IN ('EXECUTE', 'REPLAY_RESULT_ONLY'));
