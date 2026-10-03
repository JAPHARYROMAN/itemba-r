-- Party linkage, Phase 3 (PR-4): a customer over its credit limit is its own alert type.
-- Additive only: one enum value.
ALTER TYPE "AlertType" ADD VALUE IF NOT EXISTS 'CREDIT_LIMIT_BREACH';
