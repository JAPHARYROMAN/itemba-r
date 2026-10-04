-- The idle expiry sweep must find due holds without a company/branch predicate.
CREATE INDEX "pos_draft_reservations_releasedAt_expiresAt_idx"
  ON "pos_draft_reservations"("releasedAt", "expiresAt");
CREATE INDEX "pos_drafts_status_reservedUntil_idx"
  ON "pos_drafts"("status", "reservedUntil");
