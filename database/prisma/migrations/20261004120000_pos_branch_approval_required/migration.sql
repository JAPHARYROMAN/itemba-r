-- Staff capture approval is a security boundary, not a runtime bypass switch.
UPDATE "mobile_pos_branch_setups" SET "approvalRequired" = true WHERE "approvalRequired" = false;
ALTER TABLE "mobile_pos_branch_setups"
  ADD CONSTRAINT "mobile_pos_branch_setups_approval_required" CHECK ("approvalRequired" = true);
