-- Kaunta reform pilot flag: per-terminal UI version so new shell phases can
-- trial on 1-2 pilot branches before fleet rollout. Additive only.

ALTER TABLE "mobile_pos_terminals" ADD COLUMN "uiVersion" INTEGER NOT NULL DEFAULT 1;
