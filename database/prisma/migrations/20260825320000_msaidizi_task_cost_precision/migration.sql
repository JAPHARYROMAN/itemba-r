-- Proposal and adaptive-reasoning receipts account model cost to six decimal
-- places. Keep the task hard-budget ledger at the same precision so a small
-- successful call cannot round to zero when inherited by the durable task.

ALTER TABLE "msaidizi_tasks"
  ALTER COLUMN "maxModelCostUsd" TYPE DECIMAL(16,6)
    USING "maxModelCostUsd"::DECIMAL(16,6),
  ALTER COLUMN "modelCostUsd" TYPE DECIMAL(16,6)
    USING "modelCostUsd"::DECIMAL(16,6);
