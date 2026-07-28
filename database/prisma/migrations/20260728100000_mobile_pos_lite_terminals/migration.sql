-- Mobile POS Lite is configured and locked at installation time. These tables
-- are additive: existing sales, products, customers, and inventory remain
-- untouched, while new Lite sales carry an optional terminal reference.

CREATE TYPE "MobilePosTerminalStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'REVOKED');

CREATE TABLE "mobile_pos_terminals" (
    "id" TEXT NOT NULL,
    "terminalCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "divisionId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "assignedUserId" TEXT NOT NULL,
    "salespersonId" TEXT NOT NULL,
    "generalCustomerId" TEXT NOT NULL,
    "status" "MobilePosTerminalStatus" NOT NULL DEFAULT 'ACTIVE',
    "creditEnabled" BOOLEAN NOT NULL DEFAULT false,
    "offlineCashEnabled" BOOLEAN NOT NULL DEFAULT false,
    "configVersion" INTEGER NOT NULL DEFAULT 1,
    "activationTokenHash" TEXT,
    "activationExpiresAt" TIMESTAMP(3),
    "deviceSecretHash" TEXT,
    "deviceName" TEXT,
    "activatedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mobile_pos_terminals_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mobile_pos_terminal_payments" (
    "id" TEXT NOT NULL,
    "terminalId" TEXT NOT NULL,
    "paymentMethod" "SalesPaymentMethod" NOT NULL,
    "cashAccountId" TEXT NOT NULL,
    "label" TEXT,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mobile_pos_terminal_payments_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "sales_orders"
  ADD COLUMN "mobilePosTerminalId" TEXT;

CREATE UNIQUE INDEX "mobile_pos_terminals_terminalCode_key"
  ON "mobile_pos_terminals"("terminalCode");
CREATE INDEX "mobile_pos_terminals_companyId_divisionId_branchId_status_idx"
  ON "mobile_pos_terminals"("companyId", "divisionId", "branchId", "status");
CREATE INDEX "mobile_pos_terminals_assignedUserId_status_idx"
  ON "mobile_pos_terminals"("assignedUserId", "status");
CREATE INDEX "mobile_pos_terminals_salespersonId_status_idx"
  ON "mobile_pos_terminals"("salespersonId", "status");
CREATE UNIQUE INDEX "mobile_pos_terminal_payments_terminalId_paymentMethod_key"
  ON "mobile_pos_terminal_payments"("terminalId", "paymentMethod");
CREATE INDEX "mobile_pos_terminal_payments_cashAccountId_idx"
  ON "mobile_pos_terminal_payments"("cashAccountId");
CREATE INDEX "sales_orders_mobilePosTerminalId_orderDate_idx"
  ON "sales_orders"("mobilePosTerminalId", "orderDate");

ALTER TABLE "mobile_pos_terminals"
  ADD CONSTRAINT "mobile_pos_terminals_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "mobile_pos_terminals_divisionId_fkey"
  FOREIGN KEY ("divisionId") REFERENCES "divisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "mobile_pos_terminals_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "mobile_pos_terminals_assignedUserId_fkey"
  FOREIGN KEY ("assignedUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "mobile_pos_terminals_salespersonId_fkey"
  FOREIGN KEY ("salespersonId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "mobile_pos_terminals_generalCustomerId_fkey"
  FOREIGN KEY ("generalCustomerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "mobile_pos_terminal_payments"
  ADD CONSTRAINT "mobile_pos_terminal_payments_terminalId_fkey"
  FOREIGN KEY ("terminalId") REFERENCES "mobile_pos_terminals"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "mobile_pos_terminal_payments_cashAccountId_fkey"
  FOREIGN KEY ("cashAccountId") REFERENCES "cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "sales_orders"
  ADD CONSTRAINT "sales_orders_mobilePosTerminalId_fkey"
  FOREIGN KEY ("mobilePosTerminalId") REFERENCES "mobile_pos_terminals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Permission and role grants ship with the terminal schema. The statements are
-- idempotent, so they are safe when a production database was partially seeded.
INSERT INTO "permissions" ("id", "code", "description", "module", "action", "isGroupControl")
VALUES
  ('perm-mobile-pos-lite-use', 'mobile_pos_lite.use', 'Use an assigned Mobile POS Lite terminal', 'mobile_pos_lite', 'use', false),
  ('perm-mobile-pos-lite-manage', 'mobile_pos_lite.manage', 'Provision and manage Mobile POS Lite terminals', 'mobile_pos_lite', 'manage', true)
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
WHERE r.name = 'GROUP_SUPER_ADMIN'
  AND p.module = 'mobile_pos_lite'
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r.id, p.id
FROM "roles" r
CROSS JOIN "permissions" p
WHERE r.name IN ('CASHIER', 'SALESPERSON')
  AND p.code = 'mobile_pos_lite.use'
ON CONFLICT DO NOTHING;
