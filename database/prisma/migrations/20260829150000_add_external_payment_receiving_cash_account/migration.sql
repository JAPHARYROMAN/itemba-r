-- Persist the CashAccount whose denormalised currentBalance the external-payment
-- confirm posting actually incremented, stamped in the same transaction as the
-- increment. Reversal unwinds exactly this account instead of re-resolving by
-- method/currency at reversal time — a roster change between confirm and reverse
-- (account deactivated, new account created) would otherwise decrement the wrong
-- account's balance cache, or decrement one that confirm never incremented.
-- NULL = confirm bumped no balance cache (no currency-matching account existed)
-- or the row predates this column (reverse falls back to re-resolution).
ALTER TABLE "external_payments"
  ADD COLUMN "receivingCashAccountId" TEXT;
