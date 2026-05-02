-- CreateEnum
CREATE TYPE "FuelTankStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'UNDER_MAINTENANCE', 'CLOSED');

-- CreateEnum
CREATE TYPE "FuelPumpStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'UNDER_MAINTENANCE', 'CLOSED');

-- CreateEnum
CREATE TYPE "FuelNozzleStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'UNDER_MAINTENANCE', 'CLOSED');

-- CreateEnum
CREATE TYPE "FuelPriceStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'EXPIRED');

-- CreateEnum
CREATE TYPE "FuelShiftType" AS ENUM ('DAY', 'NIGHT', 'CUSTOM');

-- CreateEnum
CREATE TYPE "FuelShiftStatus" AS ENUM ('OPEN', 'SUBMITTED', 'SUPERVISOR_APPROVED', 'MANAGER_APPROVED', 'REJECTED', 'CLOSED', 'VOIDED');

-- CreateEnum
CREATE TYPE "FuelNozzleReadingStatus" AS ENUM ('OPEN', 'CLOSED', 'DISPUTED', 'VOIDED');

-- CreateEnum
CREATE TYPE "FuelTankDipStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'POSTED');

-- CreateEnum
CREATE TYPE "FuelShiftCollectionType" AS ENUM ('CASH', 'MOBILE_MONEY', 'BANK_CARD', 'BANK_DEPOSIT', 'CREDIT_SALE', 'VOUCHER', 'OTHER');

-- CreateEnum
CREATE TYPE "FuelCreditSaleStatus" AS ENUM ('OPEN', 'INVOICED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FuelDeliveryStatus" AS ENUM ('DRAFT', 'RECEIVED', 'APPROVED', 'POSTED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FuelDailyReconciliationStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'POSTED', 'REJECTED');

-- CreateTable
CREATE TABLE "fuel_tanks" (
    "id" TEXT NOT NULL,
    "tankCode" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "divisionId" TEXT,
    "branchId" TEXT NOT NULL,
    "inventoryLocationId" TEXT,
    "productId" TEXT NOT NULL,
    "tankName" TEXT NOT NULL,
    "capacityLitres" DECIMAL(18,2) NOT NULL,
    "currentBookBalance" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "lastDipBalance" DECIMAL(18,2),
    "status" "FuelTankStatus" NOT NULL DEFAULT 'ACTIVE',
    "installationDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "fuel_tanks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fuel_pumps" (
    "id" TEXT NOT NULL,
    "pumpCode" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "divisionId" TEXT,
    "branchId" TEXT NOT NULL,
    "pumpName" TEXT NOT NULL,
    "status" "FuelPumpStatus" NOT NULL DEFAULT 'ACTIVE',
    "installationDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "fuel_pumps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fuel_nozzles" (
    "id" TEXT NOT NULL,
    "nozzleCode" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "divisionId" TEXT,
    "branchId" TEXT NOT NULL,
    "pumpId" TEXT NOT NULL,
    "tankId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "nozzleName" TEXT,
    "currentMeterReading" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "status" "FuelNozzleStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "fuel_nozzles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fuel_prices" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT,
    "productId" TEXT NOT NULL,
    "pricePerLitre" DECIMAL(18,4) NOT NULL,
    "currency" "CurrencyCode" NOT NULL DEFAULT 'TZS',
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "status" "FuelPriceStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fuel_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fuel_shifts" (
    "id" TEXT NOT NULL,
    "shiftNumber" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "divisionId" TEXT,
    "branchId" TEXT NOT NULL,
    "shiftType" "FuelShiftType" NOT NULL DEFAULT 'DAY',
    "shiftDate" DATE NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3),
    "status" "FuelShiftStatus" NOT NULL DEFAULT 'OPEN',
    "openedById" TEXT NOT NULL,
    "submittedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "supervisorApprovedById" TEXT,
    "supervisorApprovedAt" TIMESTAMP(3),
    "managerApprovedById" TEXT,
    "managerApprovedAt" TIMESTAMP(3),
    "rejectedById" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "fuel_shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fuel_shift_attendants" (
    "id" TEXT NOT NULL,
    "fuelShiftId" TEXT NOT NULL,
    "attendantId" TEXT NOT NULL,
    "assignedPumpId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fuel_shift_attendants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fuel_nozzle_readings" (
    "id" TEXT NOT NULL,
    "fuelShiftId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "nozzleId" TEXT NOT NULL,
    "pumpId" TEXT NOT NULL,
    "tankId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "attendantId" TEXT,
    "openingMeter" DECIMAL(18,3) NOT NULL,
    "closingMeter" DECIMAL(18,3),
    "litresSold" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "pricePerLitre" DECIMAL(18,4) NOT NULL,
    "expectedAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status" "FuelNozzleReadingStatus" NOT NULL DEFAULT 'OPEN',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fuel_nozzle_readings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fuel_tank_dips" (
    "id" TEXT NOT NULL,
    "dipNumber" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "tankId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "dipDate" DATE NOT NULL,
    "dipTime" TIMESTAMP(3) NOT NULL,
    "bookBalance" DECIMAL(18,3) NOT NULL,
    "physicalDipLitres" DECIMAL(18,3) NOT NULL,
    "varianceLitres" DECIMAL(18,3) NOT NULL,
    "varianceValue" DECIMAL(18,2),
    "measuredById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "status" "FuelTankDipStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "fuel_tank_dips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fuel_shift_collections" (
    "id" TEXT NOT NULL,
    "fuelShiftId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "collectionType" "FuelShiftCollectionType" NOT NULL DEFAULT 'CASH',
    "amount" DECIMAL(18,2) NOT NULL,
    "reference" TEXT,
    "collectedById" TEXT,
    "cashAccountId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fuel_shift_collections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fuel_credit_sales" (
    "id" TEXT NOT NULL,
    "creditSaleNumber" TEXT NOT NULL,
    "fuelShiftId" TEXT,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "vehicleNumber" TEXT,
    "driverName" TEXT,
    "litres" DECIMAL(18,3) NOT NULL,
    "pricePerLitre" DECIMAL(18,4) NOT NULL,
    "totalAmount" DECIMAL(18,2) NOT NULL,
    "saleDate" TIMESTAMP(3) NOT NULL,
    "status" "FuelCreditSaleStatus" NOT NULL DEFAULT 'OPEN',
    "receivableId" TEXT,
    "salesOrderId" TEXT,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "fuel_credit_sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fuel_deliveries" (
    "id" TEXT NOT NULL,
    "deliveryNumber" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "tankId" TEXT NOT NULL,
    "purchaseOrderId" TEXT,
    "deliveryDate" TIMESTAMP(3) NOT NULL,
    "deliveryNoteNumber" TEXT,
    "invoiceNumber" TEXT,
    "orderedLitres" DECIMAL(18,3),
    "deliveredLitres" DECIMAL(18,3) NOT NULL,
    "acceptedLitres" DECIMAL(18,3) NOT NULL,
    "rejectedLitres" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "unitCost" DECIMAL(18,4),
    "totalCost" DECIMAL(18,2),
    "driverName" TEXT,
    "truckNumber" TEXT,
    "status" "FuelDeliveryStatus" NOT NULL DEFAULT 'DRAFT',
    "receivedById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "postedById" TEXT,
    "postedAt" TIMESTAMP(3),
    "payableId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "fuel_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fuel_daily_reconciliations" (
    "id" TEXT NOT NULL,
    "reconciliationNumber" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "reconciliationDate" DATE NOT NULL,
    "totalLitresSold" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "totalExpectedSales" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalCashCollected" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalMobileMoneyCollected" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalBankCardCollected" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalCreditSales" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalCollections" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "cashShortage" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "cashExcess" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalTankVarianceLitres" DECIMAL(18,3) NOT NULL DEFAULT 0,
    "totalTankVarianceValue" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status" "FuelDailyReconciliationStatus" NOT NULL DEFAULT 'DRAFT',
    "preparedById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "postedById" TEXT,
    "postedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "fuel_daily_reconciliations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "petroleum_attachments" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "petroleum_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fuel_tanks_companyId_idx" ON "fuel_tanks"("companyId");

-- CreateIndex
CREATE INDEX "fuel_tanks_branchId_idx" ON "fuel_tanks"("branchId");

-- CreateIndex
CREATE INDEX "fuel_tanks_productId_idx" ON "fuel_tanks"("productId");

-- CreateIndex
CREATE INDEX "fuel_tanks_status_idx" ON "fuel_tanks"("status");

-- CreateIndex
CREATE UNIQUE INDEX "fuel_tanks_branchId_tankCode_key" ON "fuel_tanks"("branchId", "tankCode");

-- CreateIndex
CREATE INDEX "fuel_pumps_companyId_idx" ON "fuel_pumps"("companyId");

-- CreateIndex
CREATE INDEX "fuel_pumps_branchId_idx" ON "fuel_pumps"("branchId");

-- CreateIndex
CREATE INDEX "fuel_pumps_status_idx" ON "fuel_pumps"("status");

-- CreateIndex
CREATE UNIQUE INDEX "fuel_pumps_branchId_pumpCode_key" ON "fuel_pumps"("branchId", "pumpCode");

-- CreateIndex
CREATE INDEX "fuel_nozzles_companyId_idx" ON "fuel_nozzles"("companyId");

-- CreateIndex
CREATE INDEX "fuel_nozzles_branchId_idx" ON "fuel_nozzles"("branchId");

-- CreateIndex
CREATE INDEX "fuel_nozzles_pumpId_idx" ON "fuel_nozzles"("pumpId");

-- CreateIndex
CREATE INDEX "fuel_nozzles_tankId_idx" ON "fuel_nozzles"("tankId");

-- CreateIndex
CREATE INDEX "fuel_nozzles_productId_idx" ON "fuel_nozzles"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "fuel_nozzles_pumpId_nozzleCode_key" ON "fuel_nozzles"("pumpId", "nozzleCode");

-- CreateIndex
CREATE INDEX "fuel_prices_companyId_idx" ON "fuel_prices"("companyId");

-- CreateIndex
CREATE INDEX "fuel_prices_branchId_idx" ON "fuel_prices"("branchId");

-- CreateIndex
CREATE INDEX "fuel_prices_productId_idx" ON "fuel_prices"("productId");

-- CreateIndex
CREATE INDEX "fuel_prices_status_idx" ON "fuel_prices"("status");

-- CreateIndex
CREATE INDEX "fuel_prices_effectiveFrom_idx" ON "fuel_prices"("effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "fuel_shifts_shiftNumber_key" ON "fuel_shifts"("shiftNumber");

-- CreateIndex
CREATE INDEX "fuel_shifts_companyId_idx" ON "fuel_shifts"("companyId");

-- CreateIndex
CREATE INDEX "fuel_shifts_branchId_idx" ON "fuel_shifts"("branchId");

-- CreateIndex
CREATE INDEX "fuel_shifts_shiftDate_idx" ON "fuel_shifts"("shiftDate");

-- CreateIndex
CREATE INDEX "fuel_shifts_status_idx" ON "fuel_shifts"("status");

-- CreateIndex
CREATE INDEX "fuel_shift_attendants_fuelShiftId_idx" ON "fuel_shift_attendants"("fuelShiftId");

-- CreateIndex
CREATE INDEX "fuel_shift_attendants_attendantId_idx" ON "fuel_shift_attendants"("attendantId");

-- CreateIndex
CREATE INDEX "fuel_nozzle_readings_fuelShiftId_idx" ON "fuel_nozzle_readings"("fuelShiftId");

-- CreateIndex
CREATE INDEX "fuel_nozzle_readings_companyId_idx" ON "fuel_nozzle_readings"("companyId");

-- CreateIndex
CREATE INDEX "fuel_nozzle_readings_branchId_idx" ON "fuel_nozzle_readings"("branchId");

-- CreateIndex
CREATE INDEX "fuel_nozzle_readings_nozzleId_idx" ON "fuel_nozzle_readings"("nozzleId");

-- CreateIndex
CREATE INDEX "fuel_nozzle_readings_tankId_idx" ON "fuel_nozzle_readings"("tankId");

-- CreateIndex
CREATE UNIQUE INDEX "fuel_tank_dips_dipNumber_key" ON "fuel_tank_dips"("dipNumber");

-- CreateIndex
CREATE INDEX "fuel_tank_dips_companyId_idx" ON "fuel_tank_dips"("companyId");

-- CreateIndex
CREATE INDEX "fuel_tank_dips_branchId_idx" ON "fuel_tank_dips"("branchId");

-- CreateIndex
CREATE INDEX "fuel_tank_dips_tankId_idx" ON "fuel_tank_dips"("tankId");

-- CreateIndex
CREATE INDEX "fuel_tank_dips_dipDate_idx" ON "fuel_tank_dips"("dipDate");

-- CreateIndex
CREATE INDEX "fuel_tank_dips_status_idx" ON "fuel_tank_dips"("status");

-- CreateIndex
CREATE INDEX "fuel_shift_collections_fuelShiftId_idx" ON "fuel_shift_collections"("fuelShiftId");

-- CreateIndex
CREATE INDEX "fuel_shift_collections_companyId_idx" ON "fuel_shift_collections"("companyId");

-- CreateIndex
CREATE INDEX "fuel_shift_collections_branchId_idx" ON "fuel_shift_collections"("branchId");

-- CreateIndex
CREATE INDEX "fuel_shift_collections_collectionType_idx" ON "fuel_shift_collections"("collectionType");

-- CreateIndex
CREATE UNIQUE INDEX "fuel_credit_sales_creditSaleNumber_key" ON "fuel_credit_sales"("creditSaleNumber");

-- CreateIndex
CREATE INDEX "fuel_credit_sales_companyId_idx" ON "fuel_credit_sales"("companyId");

-- CreateIndex
CREATE INDEX "fuel_credit_sales_branchId_idx" ON "fuel_credit_sales"("branchId");

-- CreateIndex
CREATE INDEX "fuel_credit_sales_customerId_idx" ON "fuel_credit_sales"("customerId");

-- CreateIndex
CREATE INDEX "fuel_credit_sales_saleDate_idx" ON "fuel_credit_sales"("saleDate");

-- CreateIndex
CREATE INDEX "fuel_credit_sales_status_idx" ON "fuel_credit_sales"("status");

-- CreateIndex
CREATE UNIQUE INDEX "fuel_deliveries_deliveryNumber_key" ON "fuel_deliveries"("deliveryNumber");

-- CreateIndex
CREATE INDEX "fuel_deliveries_companyId_idx" ON "fuel_deliveries"("companyId");

-- CreateIndex
CREATE INDEX "fuel_deliveries_branchId_idx" ON "fuel_deliveries"("branchId");

-- CreateIndex
CREATE INDEX "fuel_deliveries_supplierId_idx" ON "fuel_deliveries"("supplierId");

-- CreateIndex
CREATE INDEX "fuel_deliveries_tankId_idx" ON "fuel_deliveries"("tankId");

-- CreateIndex
CREATE INDEX "fuel_deliveries_deliveryDate_idx" ON "fuel_deliveries"("deliveryDate");

-- CreateIndex
CREATE INDEX "fuel_deliveries_status_idx" ON "fuel_deliveries"("status");

-- CreateIndex
CREATE UNIQUE INDEX "fuel_daily_reconciliations_reconciliationNumber_key" ON "fuel_daily_reconciliations"("reconciliationNumber");

-- CreateIndex
CREATE INDEX "fuel_daily_reconciliations_companyId_idx" ON "fuel_daily_reconciliations"("companyId");

-- CreateIndex
CREATE INDEX "fuel_daily_reconciliations_branchId_idx" ON "fuel_daily_reconciliations"("branchId");

-- CreateIndex
CREATE INDEX "fuel_daily_reconciliations_reconciliationDate_idx" ON "fuel_daily_reconciliations"("reconciliationDate");

-- CreateIndex
CREATE INDEX "fuel_daily_reconciliations_status_idx" ON "fuel_daily_reconciliations"("status");

-- CreateIndex
CREATE UNIQUE INDEX "fuel_daily_reconciliations_branchId_reconciliationDate_key" ON "fuel_daily_reconciliations"("branchId", "reconciliationDate");

-- CreateIndex
CREATE INDEX "petroleum_attachments_companyId_idx" ON "petroleum_attachments"("companyId");

-- CreateIndex
CREATE INDEX "petroleum_attachments_entityType_entityId_idx" ON "petroleum_attachments"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "petroleum_attachments_entityType_entityId_documentId_key" ON "petroleum_attachments"("entityType", "entityId", "documentId");

-- AddForeignKey
ALTER TABLE "fuel_tanks" ADD CONSTRAINT "fuel_tanks_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_tanks" ADD CONSTRAINT "fuel_tanks_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "divisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_tanks" ADD CONSTRAINT "fuel_tanks_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_tanks" ADD CONSTRAINT "fuel_tanks_inventoryLocationId_fkey" FOREIGN KEY ("inventoryLocationId") REFERENCES "inventory_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_tanks" ADD CONSTRAINT "fuel_tanks_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_pumps" ADD CONSTRAINT "fuel_pumps_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_pumps" ADD CONSTRAINT "fuel_pumps_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "divisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_pumps" ADD CONSTRAINT "fuel_pumps_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_nozzles" ADD CONSTRAINT "fuel_nozzles_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_nozzles" ADD CONSTRAINT "fuel_nozzles_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "divisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_nozzles" ADD CONSTRAINT "fuel_nozzles_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_nozzles" ADD CONSTRAINT "fuel_nozzles_pumpId_fkey" FOREIGN KEY ("pumpId") REFERENCES "fuel_pumps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_nozzles" ADD CONSTRAINT "fuel_nozzles_tankId_fkey" FOREIGN KEY ("tankId") REFERENCES "fuel_tanks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_nozzles" ADD CONSTRAINT "fuel_nozzles_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_prices" ADD CONSTRAINT "fuel_prices_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_prices" ADD CONSTRAINT "fuel_prices_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_prices" ADD CONSTRAINT "fuel_prices_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_prices" ADD CONSTRAINT "fuel_prices_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_prices" ADD CONSTRAINT "fuel_prices_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_shifts" ADD CONSTRAINT "fuel_shifts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_shifts" ADD CONSTRAINT "fuel_shifts_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "divisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_shifts" ADD CONSTRAINT "fuel_shifts_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_shifts" ADD CONSTRAINT "fuel_shifts_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_shifts" ADD CONSTRAINT "fuel_shifts_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_shifts" ADD CONSTRAINT "fuel_shifts_supervisorApprovedById_fkey" FOREIGN KEY ("supervisorApprovedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_shifts" ADD CONSTRAINT "fuel_shifts_managerApprovedById_fkey" FOREIGN KEY ("managerApprovedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_shifts" ADD CONSTRAINT "fuel_shifts_rejectedById_fkey" FOREIGN KEY ("rejectedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_shift_attendants" ADD CONSTRAINT "fuel_shift_attendants_fuelShiftId_fkey" FOREIGN KEY ("fuelShiftId") REFERENCES "fuel_shifts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_shift_attendants" ADD CONSTRAINT "fuel_shift_attendants_attendantId_fkey" FOREIGN KEY ("attendantId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_shift_attendants" ADD CONSTRAINT "fuel_shift_attendants_assignedPumpId_fkey" FOREIGN KEY ("assignedPumpId") REFERENCES "fuel_pumps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_nozzle_readings" ADD CONSTRAINT "fuel_nozzle_readings_fuelShiftId_fkey" FOREIGN KEY ("fuelShiftId") REFERENCES "fuel_shifts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_nozzle_readings" ADD CONSTRAINT "fuel_nozzle_readings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_nozzle_readings" ADD CONSTRAINT "fuel_nozzle_readings_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_nozzle_readings" ADD CONSTRAINT "fuel_nozzle_readings_nozzleId_fkey" FOREIGN KEY ("nozzleId") REFERENCES "fuel_nozzles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_nozzle_readings" ADD CONSTRAINT "fuel_nozzle_readings_pumpId_fkey" FOREIGN KEY ("pumpId") REFERENCES "fuel_pumps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_nozzle_readings" ADD CONSTRAINT "fuel_nozzle_readings_tankId_fkey" FOREIGN KEY ("tankId") REFERENCES "fuel_tanks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_nozzle_readings" ADD CONSTRAINT "fuel_nozzle_readings_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_nozzle_readings" ADD CONSTRAINT "fuel_nozzle_readings_attendantId_fkey" FOREIGN KEY ("attendantId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_tank_dips" ADD CONSTRAINT "fuel_tank_dips_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_tank_dips" ADD CONSTRAINT "fuel_tank_dips_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_tank_dips" ADD CONSTRAINT "fuel_tank_dips_tankId_fkey" FOREIGN KEY ("tankId") REFERENCES "fuel_tanks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_tank_dips" ADD CONSTRAINT "fuel_tank_dips_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_tank_dips" ADD CONSTRAINT "fuel_tank_dips_measuredById_fkey" FOREIGN KEY ("measuredById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_tank_dips" ADD CONSTRAINT "fuel_tank_dips_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_shift_collections" ADD CONSTRAINT "fuel_shift_collections_fuelShiftId_fkey" FOREIGN KEY ("fuelShiftId") REFERENCES "fuel_shifts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_shift_collections" ADD CONSTRAINT "fuel_shift_collections_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_shift_collections" ADD CONSTRAINT "fuel_shift_collections_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_shift_collections" ADD CONSTRAINT "fuel_shift_collections_cashAccountId_fkey" FOREIGN KEY ("cashAccountId") REFERENCES "cash_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_credit_sales" ADD CONSTRAINT "fuel_credit_sales_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_credit_sales" ADD CONSTRAINT "fuel_credit_sales_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_credit_sales" ADD CONSTRAINT "fuel_credit_sales_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_credit_sales" ADD CONSTRAINT "fuel_credit_sales_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_credit_sales" ADD CONSTRAINT "fuel_credit_sales_fuelShiftId_fkey" FOREIGN KEY ("fuelShiftId") REFERENCES "fuel_shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_credit_sales" ADD CONSTRAINT "fuel_credit_sales_receivableId_fkey" FOREIGN KEY ("receivableId") REFERENCES "receivables"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_credit_sales" ADD CONSTRAINT "fuel_credit_sales_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_deliveries" ADD CONSTRAINT "fuel_deliveries_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_deliveries" ADD CONSTRAINT "fuel_deliveries_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_deliveries" ADD CONSTRAINT "fuel_deliveries_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_deliveries" ADD CONSTRAINT "fuel_deliveries_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_deliveries" ADD CONSTRAINT "fuel_deliveries_tankId_fkey" FOREIGN KEY ("tankId") REFERENCES "fuel_tanks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_deliveries" ADD CONSTRAINT "fuel_deliveries_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_deliveries" ADD CONSTRAINT "fuel_deliveries_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_deliveries" ADD CONSTRAINT "fuel_deliveries_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_deliveries" ADD CONSTRAINT "fuel_deliveries_postedById_fkey" FOREIGN KEY ("postedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_deliveries" ADD CONSTRAINT "fuel_deliveries_payableId_fkey" FOREIGN KEY ("payableId") REFERENCES "payables"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_daily_reconciliations" ADD CONSTRAINT "fuel_daily_reconciliations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_daily_reconciliations" ADD CONSTRAINT "fuel_daily_reconciliations_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_daily_reconciliations" ADD CONSTRAINT "fuel_daily_reconciliations_preparedById_fkey" FOREIGN KEY ("preparedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_daily_reconciliations" ADD CONSTRAINT "fuel_daily_reconciliations_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fuel_daily_reconciliations" ADD CONSTRAINT "fuel_daily_reconciliations_postedById_fkey" FOREIGN KEY ("postedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "petroleum_attachments" ADD CONSTRAINT "petroleum_attachments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "petroleum_attachments" ADD CONSTRAINT "petroleum_attachments_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
