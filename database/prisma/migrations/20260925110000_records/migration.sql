-- CreateTable
CREATE TABLE "record_entries" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "payloadKey" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "companyId" TEXT,
    "divisionId" TEXT,
    "branchId" TEXT,
    "kind" VARCHAR(12) NOT NULL,
    "title" VARCHAR(180) NOT NULL,
    "counterparty" VARCHAR(180),
    "contact" VARCHAR(160),
    "reference" VARCHAR(100),
    "category" VARCHAR(80),
    "notes" VARCHAR(10000),
    "currency" VARCHAR(3) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "settledAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "recordDate" DATE NOT NULL,
    "dueDate" DATE,
    "version" INTEGER NOT NULL DEFAULT 1,
    "voidedAt" TIMESTAMP(3),
    "voidReason" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "record_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "record_settlements" (
    "id" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "payloadKey" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "date" DATE NOT NULL,
    "reference" VARCHAR(160),
    "notes" VARCHAR(500),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversedAt" TIMESTAMP(3),
    "reversalReason" VARCHAR(500),

    CONSTRAINT "record_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "record_events" (
    "id" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "record_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "record_entries_requestId_key" ON "record_entries"("requestId");

-- CreateIndex
CREATE INDEX "record_entries_ownerId_recordDate_idx" ON "record_entries"("ownerId", "recordDate");

-- CreateIndex
CREATE INDEX "record_entries_companyId_divisionId_branchId_kind_recordDat_idx" ON "record_entries"("companyId", "divisionId", "branchId", "kind", "recordDate");

-- CreateIndex
CREATE UNIQUE INDEX "record_settlements_requestId_key" ON "record_settlements"("requestId");

-- CreateIndex
CREATE INDEX "record_settlements_recordId_date_idx" ON "record_settlements"("recordId", "date");

-- CreateIndex
CREATE INDEX "record_events_recordId_createdAt_idx" ON "record_events"("recordId", "createdAt");

-- AddForeignKey
ALTER TABLE "record_entries" ADD CONSTRAINT "record_entries_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "record_entries" ADD CONSTRAINT "record_entries_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "record_entries" ADD CONSTRAINT "record_entries_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "divisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "record_entries" ADD CONSTRAINT "record_entries_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "record_settlements" ADD CONSTRAINT "record_settlements_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "record_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "record_events" ADD CONSTRAINT "record_events_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "record_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "record_entries" ADD CONSTRAINT "record_entries_kind" CHECK ("kind" IN ('DEBTOR','CREDITOR','SALE','PURCHASE','EXPENSE','NOTE'));
ALTER TABLE "record_entries" ADD CONSTRAINT "record_entries_amounts" CHECK (
  (("kind" = 'NOTE' AND "amount" = 0) OR ("kind" <> 'NOTE' AND "amount" > 0)) AND
  "settledAmount" >= 0 AND "settledAmount" <= "amount" AND
  ("kind" IN ('DEBTOR','CREDITOR') OR "settledAmount" = 0) AND
  ("voidedAt" IS NULL OR "settledAmount" = 0));
ALTER TABLE "record_entries" ADD CONSTRAINT "record_entries_scope" CHECK (("divisionId" IS NULL OR "companyId" IS NOT NULL) AND ("branchId" IS NULL OR "divisionId" IS NOT NULL));
ALTER TABLE "record_entries" ADD CONSTRAINT "record_entries_dates" CHECK ("dueDate" IS NULL OR ("kind" IN ('DEBTOR','CREDITOR') AND "dueDate" >= "recordDate"));
ALTER TABLE "record_settlements" ADD CONSTRAINT "record_settlements_positive" CHECK ("amount" > 0);

INSERT INTO "permissions" ("id","code","description","module","action","isGroupControl") VALUES
('perm-records-view','records.view','View independent Records registers','records','view',false),
('perm-records-manage','records.manage','Create, edit and settle independent Records entries','records','manage',false),
('perm-records-export','records.export','Export independent Records registers','records','export',false)
ON CONFLICT ("code") DO UPDATE SET "description"=EXCLUDED."description";
INSERT INTO "role_permissions" ("roleId","permissionId") SELECT r."id",p."id" FROM "roles" r CROSS JOIN "permissions" p WHERE r."name"='GROUP_SUPER_ADMIN' AND p."module"='records' ON CONFLICT DO NOTHING;
