CREATE TABLE "fuel_reports" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "branchId" TEXT NOT NULL,
  "businessDate" DATE NOT NULL,
  "shift" TEXT NOT NULL CHECK ("shift" IN ('DAY', 'NIGHT')),
  "status" TEXT NOT NULL DEFAULT 'DRAFT' CHECK ("status" IN ('DRAFT', 'CLOSED')),
  "version" INTEGER NOT NULL DEFAULT 1,
  "payload" JSONB NOT NULL,
  "summary" JSONB NOT NULL,
  "closedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "fuel_reports_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fuel_reports_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fuel_reports_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "fuel_reports_branchId_businessDate_shift_key" ON "fuel_reports"("branchId", "businessDate", "shift");
CREATE INDEX "fuel_reports_companyId_businessDate_idx" ON "fuel_reports"("companyId", "businessDate");
CREATE TABLE "fuel_report_revisions" (
  "id" TEXT NOT NULL,
  "reportId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "action" TEXT NOT NULL,
  "reason" TEXT,
  "payload" JSONB NOT NULL,
  "summary" JSONB NOT NULL,
  "authorId" TEXT NOT NULL,
  "authorName" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fuel_report_revisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fuel_report_revisions_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "fuel_reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "fuel_report_revisions_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "fuel_report_revisions_reportId_version_key" ON "fuel_report_revisions"("reportId", "version");

INSERT INTO "permissions" ("id", "code", "description", "module", "action", "isGroupControl")
VALUES
('5dc45887-a24a-43a4-9051-8655c60e0911', 'fuel_reporting.read', 'Read station shift reports', 'fuel_reporting', 'read', false),
('5dc45887-a24a-43a4-9051-8655c60e0912', 'fuel_reporting.manage', 'Enter and close station shift reports', 'fuel_reporting', 'manage', false),
('5dc45887-a24a-43a4-9051-8655c60e0913', 'fuel_reporting.admin', 'Configure fuel reporting pumps and tanks', 'fuel_reporting', 'admin', true)
ON CONFLICT ("code") DO NOTHING;
INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "roles" r CROSS JOIN "permissions" p
WHERE p."module" = 'fuel_reporting' AND (
  r."name" = 'GROUP_SUPER_ADMIN' OR
  (r."name" = 'BRANCH_MANAGER' AND p."action" IN ('read', 'manage')) OR
  (r."name" IN ('COMPANY_MANAGER', 'GROUP_DIRECTOR', 'GROUP_AUDITOR', 'ACCOUNTANT') AND p."action" = 'read')
)
ON CONFLICT DO NOTHING;
