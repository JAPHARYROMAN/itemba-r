CREATE TYPE "SupplierOrderDraftStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'DECLINED', 'CANCELLED');

CREATE TABLE "supplier_order_drafts" (
    "id" TEXT NOT NULL,
    "draftNumber" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "divisionId" TEXT,
    "branchId" TEXT,
    "supplierId" TEXT,
    "supplierName" TEXT NOT NULL,
    "supplierAddress" TEXT,
    "supplierContact" TEXT,
    "supplierTin" TEXT,
    "supplierVrn" TEXT,
    "supplierPhone" TEXT,
    "supplierEmail" TEXT,
    "draftDate" TIMESTAMP(3) NOT NULL,
    "neededBy" TIMESTAMP(3),
    "currency" "CurrencyCode" NOT NULL DEFAULT 'TZS',
    "title" TEXT,
    "deliveryInstructions" TEXT,
    "terms" TEXT,
    "notes" TEXT,
    "subtotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "hasUnpricedLines" BOOLEAN NOT NULL DEFAULT false,
    "status" "SupplierOrderDraftStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "declinedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "supplier_order_drafts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "supplier_order_draft_lines" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "itemCode" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unitLabel" TEXT NOT NULL,
    "unitPrice" DECIMAL(18,4),
    "discountAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(18,2),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "supplier_order_draft_lines_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "supplier_order_drafts_companyId_draftNumber_key" ON "supplier_order_drafts"("companyId", "draftNumber");
CREATE INDEX "supplier_order_drafts_companyId_status_draftDate_idx" ON "supplier_order_drafts"("companyId", "status", "draftDate");
CREATE INDEX "supplier_order_drafts_supplierId_idx" ON "supplier_order_drafts"("supplierId");
CREATE INDEX "supplier_order_drafts_divisionId_idx" ON "supplier_order_drafts"("divisionId");
CREATE INDEX "supplier_order_drafts_branchId_idx" ON "supplier_order_drafts"("branchId");
CREATE UNIQUE INDEX "supplier_order_draft_lines_draftId_lineNumber_key" ON "supplier_order_draft_lines"("draftId", "lineNumber");
CREATE INDEX "supplier_order_draft_lines_draftId_idx" ON "supplier_order_draft_lines"("draftId");

ALTER TABLE "supplier_order_drafts" ADD CONSTRAINT "supplier_order_drafts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_order_drafts" ADD CONSTRAINT "supplier_order_drafts_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "divisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "supplier_order_drafts" ADD CONSTRAINT "supplier_order_drafts_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "supplier_order_drafts" ADD CONSTRAINT "supplier_order_drafts_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "supplier_order_drafts" ADD CONSTRAINT "supplier_order_drafts_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_order_draft_lines" ADD CONSTRAINT "supplier_order_draft_lines_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "supplier_order_drafts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed the permissions in the same deployment that creates the workspace.
-- These statements are idempotent so the migration remains safe after a
-- partial/manual permission rollout.
INSERT INTO "permissions" ("id", "code", "description", "module", "action", "isGroupControl")
VALUES
  ('perm-supplier-order-drafts-view', 'supplier_order_drafts.view', 'View supplier order drafts', 'supplier_order_drafts', 'view', false),
  ('perm-supplier-order-drafts-create', 'supplier_order_drafts.create', 'Create supplier order drafts', 'supplier_order_drafts', 'create', false),
  ('perm-supplier-order-drafts-update', 'supplier_order_drafts.update', 'Update draft supplier orders', 'supplier_order_drafts', 'update', false),
  ('perm-supplier-order-drafts-send', 'supplier_order_drafts.send', 'Mark supplier order drafts as sent', 'supplier_order_drafts', 'send', false),
  ('perm-supplier-order-drafts-manage', 'supplier_order_drafts.manage', 'Manage supplier order draft lifecycle', 'supplier_order_drafts', 'manage', false),
  ('perm-supplier-order-drafts-export', 'supplier_order_drafts.export', 'Export supplier order drafts', 'supplier_order_drafts', 'export', false)
ON CONFLICT ("code") DO UPDATE
SET
  "description" = EXCLUDED."description",
  "module" = EXCLUDED."module",
  "action" = EXCLUDED."action",
  "isGroupControl" = EXCLUDED."isGroupControl";

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r.id, p.id
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r.name IN (
    'GROUP_SUPER_ADMIN',
    'GROUP_FINANCE_CONTROLLER',
    'COMPANY_MANAGER',
    'BRANCH_MANAGER',
    'PROCUREMENT_OFFICER'
  )
  AND p.module = 'supplier_order_drafts'
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r.id, p.id
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r.name = 'GROUP_DIRECTOR'
  AND p.module = 'supplier_order_drafts'
  AND p.action IN ('view', 'export')
ON CONFLICT DO NOTHING;
