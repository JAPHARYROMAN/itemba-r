-- CreateEnum
CREATE TYPE "ItembaWorkUnitType" AS ENUM ('LOGISTICS_ROUTE', 'AGRICULTURE_FARM', 'AGRICULTURE_FIELD', 'CONSTRUCTION_PROJECT', 'CONSTRUCTION_SITE', 'WAREHOUSE', 'WORKSHOP', 'OTHER');

-- CreateEnum
CREATE TYPE "ItembaWorkUnitStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'COMPLETED', 'SUSPENDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "EquipmentUsageContextType" AS ENUM ('LOGISTICS_TRIP', 'AGRICULTURE_FIELD', 'AGRICULTURE_SEASON', 'CONSTRUCTION_PROJECT', 'CONSTRUCTION_SITE', 'GENERAL');

-- CreateEnum
CREATE TYPE "LaborContextType" AS ENUM ('AGRICULTURE_FIELD', 'AGRICULTURE_SEASON', 'CONSTRUCTION_PROJECT', 'CONSTRUCTION_SITE', 'LOGISTICS_TRIP', 'GENERAL');

-- CreateEnum
CREATE TYPE "LaborPaymentStatus" AS ENUM ('UNPAID', 'PARTIALLY_PAID', 'PAID');

-- CreateEnum
CREATE TYPE "VehicleType" AS ENUM ('TRUCK', 'TRAILER', 'PICKUP', 'VAN', 'MOTORCYCLE', 'TRACTOR', 'HEAVY_EQUIPMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "VehicleFuelType" AS ENUM ('DIESEL', 'PETROL', 'ELECTRIC', 'HYBRID', 'OTHER');

-- CreateEnum
CREATE TYPE "VehicleStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'UNDER_MAINTENANCE', 'SOLD', 'DISPOSED');

-- CreateEnum
CREATE TYPE "DriverStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "RouteStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "TripStatus" AS ENUM ('PLANNED', 'DISPATCHED', 'IN_TRANSIT', 'COMPLETED', 'CANCELLED', 'CLOSED');

-- CreateEnum
CREATE TYPE "TripExpenseType" AS ENUM ('FUEL', 'DRIVER_ALLOWANCE', 'TOLL', 'PARKING', 'MAINTENANCE', 'LOADING', 'UNLOADING', 'FOOD', 'ACCOMMODATION', 'POLICE_FINE', 'OTHER');

-- CreateEnum
CREATE TYPE "FuelSource" AS ENUM ('INTERNAL', 'EXTERNAL_STATION', 'MWANJALISI_OIL', 'OTHER');

-- CreateEnum
CREATE TYPE "MaintenanceType" AS ENUM ('SERVICE', 'REPAIR', 'INSPECTION', 'TYRE', 'OIL_CHANGE', 'BREAKDOWN', 'OTHER');

-- CreateEnum
CREATE TYPE "MaintenanceStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FarmOwnershipType" AS ENUM ('OWNED', 'LEASED', 'RENTED', 'PARTNERSHIP', 'OTHER');

-- CreateEnum
CREATE TYPE "FarmStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'UNDER_PREPARATION', 'CLOSED');

-- CreateEnum
CREATE TYPE "FarmFieldStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'FALLOW', 'PLANTED', 'HARVESTED');

-- CreateEnum
CREATE TYPE "CropType" AS ENUM ('GRAIN', 'VEGETABLE', 'FRUIT', 'CASH_CROP', 'LEGUME', 'ROOT_CROP', 'OTHER');

-- CreateEnum
CREATE TYPE "CropStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "CropSeasonStatus" AS ENUM ('PLANNED', 'LAND_PREPARATION', 'PLANTED', 'GROWING', 'HARVESTING', 'HARVESTED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FarmInputApplicationType" AS ENUM ('SEEDING', 'FERTILIZER', 'CHEMICAL', 'PESTICIDE', 'HERBICIDE', 'IRRIGATION', 'OTHER');

-- CreateEnum
CREATE TYPE "HarvestRecordStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'POSTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AgricultureActivityType" AS ENUM ('LAND_PREPARATION', 'PLANTING', 'WEEDING', 'IRRIGATION', 'SPRAYING', 'FERTILIZER_APPLICATION', 'HARVESTING', 'TRANSPORT', 'STORAGE', 'OTHER');

-- CreateEnum
CREATE TYPE "AgricultureActivityStatus" AS ENUM ('PLANNED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ConstructionProjectType" AS ENUM ('RESIDENTIAL', 'COMMERCIAL', 'ROAD', 'CIVIL_WORKS', 'RENOVATION', 'SUPPLY_AND_INSTALL', 'OTHER');

-- CreateEnum
CREATE TYPE "ConstructionProjectStatus" AS ENUM ('PLANNED', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ConstructionSiteStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "BOQItemStatus" AS ENUM ('ACTIVE', 'REVISED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MaterialIssueStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'POSTED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SubcontractorStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'COMPLETED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "ProjectProgressStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ProjectBillingStatus" AS ENUM ('DRAFT', 'SENT', 'APPROVED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED');

-- CreateTable
CREATE TABLE "itemba_work_units" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "divisionId" TEXT NOT NULL,
    "branchId" TEXT,
    "workUnitCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "workUnitType" "ItembaWorkUnitType" NOT NULL,
    "status" "ItembaWorkUnitStatus" NOT NULL DEFAULT 'ACTIVE',
    "location" TEXT,
    "managerId" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "itemba_work_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment_usages" (
    "id" TEXT NOT NULL,
    "usageNumber" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "divisionId" TEXT NOT NULL,
    "branchId" TEXT,
    "fixedAssetId" TEXT,
    "equipmentName" TEXT,
    "usageContextType" "EquipmentUsageContextType" NOT NULL DEFAULT 'GENERAL',
    "usageContextId" TEXT,
    "usageDate" DATE NOT NULL,
    "startMeterReading" DECIMAL(18,2),
    "endMeterReading" DECIMAL(18,2),
    "hoursUsed" DECIMAL(10,2),
    "fuelUsedLitres" DECIMAL(10,2),
    "operatorId" TEXT,
    "costAmount" DECIMAL(18,2),
    "currency" TEXT,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "equipment_usages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "labor_records" (
    "id" TEXT NOT NULL,
    "laborRecordNumber" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "divisionId" TEXT NOT NULL,
    "branchId" TEXT,
    "laborContextType" "LaborContextType" NOT NULL DEFAULT 'GENERAL',
    "laborContextId" TEXT,
    "workerId" TEXT,
    "workerName" TEXT,
    "laborDate" DATE NOT NULL,
    "role" TEXT,
    "hoursWorked" DECIMAL(10,2),
    "dayRate" DECIMAL(18,2),
    "totalAmount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "paymentStatus" "LaborPaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "expenseId" TEXT,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "labor_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicles" (
    "id" TEXT NOT NULL,
    "vehicleCode" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "divisionId" TEXT NOT NULL,
    "fixedAssetId" TEXT,
    "registrationNumber" TEXT NOT NULL,
    "vehicleType" "VehicleType" NOT NULL,
    "make" TEXT,
    "model" TEXT,
    "year" INTEGER,
    "capacityDescription" TEXT,
    "fuelType" "VehicleFuelType" NOT NULL DEFAULT 'DIESEL',
    "status" "VehicleStatus" NOT NULL DEFAULT 'ACTIVE',
    "currentOdometer" DECIMAL(12,2),
    "insuranceExpiryDate" DATE,
    "roadLicenseExpiryDate" DATE,
    "inspectionExpiryDate" DATE,
    "assignedDriverId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_profiles" (
    "id" TEXT NOT NULL,
    "driverCode" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "divisionId" TEXT NOT NULL,
    "userId" TEXT,
    "employeeId" TEXT,
    "fullName" TEXT NOT NULL,
    "phone" TEXT,
    "licenseNumber" TEXT,
    "licenseClass" TEXT,
    "licenseExpiryDate" DATE,
    "status" "DriverStatus" NOT NULL DEFAULT 'ACTIVE',
    "assignedVehicleId" TEXT,
    "emergencyContact" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "driver_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "routes" (
    "id" TEXT NOT NULL,
    "routeCode" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "divisionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "distanceKm" DECIMAL(10,2),
    "estimatedDuration" TEXT,
    "standardRate" DECIMAL(18,2),
    "currency" TEXT,
    "status" "RouteStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trips" (
    "id" TEXT NOT NULL,
    "tripNumber" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "divisionId" TEXT NOT NULL,
    "branchId" TEXT,
    "customerId" TEXT,
    "customerName" TEXT,
    "vehicleId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "routeId" TEXT,
    "origin" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "cargoDescription" TEXT,
    "cargoWeight" DECIMAL(12,2),
    "cargoUnitId" TEXT,
    "tripDate" DATE NOT NULL,
    "expectedReturnDate" DATE,
    "actualReturnDate" DATE,
    "revenueAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL,
    "status" "TripStatus" NOT NULL DEFAULT 'PLANNED',
    "salesOrderId" TEXT,
    "receivableId" TEXT,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "dispatchedById" TEXT,
    "completedById" TEXT,
    "closedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "trips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_expenses" (
    "id" TEXT NOT NULL,
    "tripExpenseNumber" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "divisionId" TEXT NOT NULL,
    "expenseType" "TripExpenseType" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "expenseDate" DATE NOT NULL,
    "description" TEXT,
    "expenseId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "trip_expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_fuel_usages" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "divisionId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "fuelSource" "FuelSource" NOT NULL DEFAULT 'EXTERNAL_STATION',
    "litres" DECIMAL(10,2) NOT NULL,
    "unitPrice" DECIMAL(18,2),
    "totalCost" DECIMAL(18,2),
    "odometerBefore" DECIMAL(12,2),
    "odometerAfter" DECIMAL(12,2),
    "fuelDate" DATE NOT NULL,
    "supplierId" TEXT,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "trip_fuel_usages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_maintenances" (
    "id" TEXT NOT NULL,
    "maintenanceNumber" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "divisionId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "maintenanceType" "MaintenanceType" NOT NULL,
    "maintenanceDate" DATE NOT NULL,
    "odometerReading" DECIMAL(12,2),
    "supplierId" TEXT,
    "description" TEXT NOT NULL,
    "costAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL,
    "status" "MaintenanceStatus" NOT NULL DEFAULT 'SCHEDULED',
    "expenseId" TEXT,
    "nextServiceDate" DATE,
    "nextServiceOdometer" DECIMAL(12,2),
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "vehicle_maintenances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "farms" (
    "id" TEXT NOT NULL,
    "farmCode" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "divisionId" TEXT NOT NULL,
    "fixedAssetId" TEXT,
    "name" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "sizeValue" DECIMAL(12,2),
    "sizeUnitId" TEXT,
    "ownershipType" "FarmOwnershipType" NOT NULL DEFAULT 'OWNED',
    "status" "FarmStatus" NOT NULL DEFAULT 'ACTIVE',
    "managerId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "farms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "farm_fields" (
    "id" TEXT NOT NULL,
    "fieldCode" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "divisionId" TEXT NOT NULL,
    "farmId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sizeValue" DECIMAL(12,2),
    "sizeUnitId" TEXT,
    "soilType" TEXT,
    "irrigationType" TEXT,
    "status" "FarmFieldStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "farm_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crops" (
    "id" TEXT NOT NULL,
    "cropCode" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "divisionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cropType" "CropType" NOT NULL,
    "defaultGrowingDays" INTEGER,
    "defaultUnitId" TEXT,
    "status" "CropStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "crops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crop_seasons" (
    "id" TEXT NOT NULL,
    "seasonCode" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "divisionId" TEXT NOT NULL,
    "farmId" TEXT NOT NULL,
    "fieldId" TEXT,
    "cropId" TEXT NOT NULL,
    "seasonName" TEXT NOT NULL,
    "plantingDate" DATE,
    "expectedHarvestDate" DATE,
    "actualHarvestDate" DATE,
    "expectedYield" DECIMAL(12,2),
    "actualYield" DECIMAL(12,2),
    "yieldUnitId" TEXT,
    "status" "CropSeasonStatus" NOT NULL DEFAULT 'PLANNED',
    "budgetAmount" DECIMAL(18,2),
    "actualCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "revenueAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "currency" TEXT,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "crop_seasons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "farm_input_applications" (
    "id" TEXT NOT NULL,
    "applicationNumber" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "divisionId" TEXT NOT NULL,
    "farmId" TEXT NOT NULL,
    "fieldId" TEXT,
    "cropSeasonId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "inventoryLocationId" TEXT,
    "applicationDate" DATE NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL,
    "unitId" TEXT NOT NULL,
    "unitCost" DECIMAL(18,2),
    "totalCost" DECIMAL(18,2),
    "applicationType" "FarmInputApplicationType" NOT NULL,
    "appliedById" TEXT,
    "notes" TEXT,
    "postedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "farm_input_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "harvest_records" (
    "id" TEXT NOT NULL,
    "harvestNumber" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "divisionId" TEXT NOT NULL,
    "farmId" TEXT NOT NULL,
    "fieldId" TEXT,
    "cropSeasonId" TEXT NOT NULL,
    "productId" TEXT,
    "harvestDate" DATE NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL,
    "unitId" TEXT NOT NULL,
    "qualityGrade" TEXT,
    "inventoryLocationId" TEXT,
    "estimatedUnitValue" DECIMAL(18,2),
    "estimatedTotalValue" DECIMAL(18,2),
    "status" "HarvestRecordStatus" NOT NULL DEFAULT 'DRAFT',
    "harvestedById" TEXT,
    "approvedById" TEXT,
    "postedById" TEXT,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "harvest_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agriculture_activities" (
    "id" TEXT NOT NULL,
    "activityNumber" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "divisionId" TEXT NOT NULL,
    "farmId" TEXT NOT NULL,
    "fieldId" TEXT,
    "cropSeasonId" TEXT,
    "activityType" "AgricultureActivityType" NOT NULL,
    "activityDate" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "costAmount" DECIMAL(18,2),
    "currency" TEXT,
    "status" "AgricultureActivityStatus" NOT NULL DEFAULT 'PLANNED',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "agriculture_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "construction_projects" (
    "id" TEXT NOT NULL,
    "projectCode" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "divisionId" TEXT NOT NULL,
    "branchId" TEXT,
    "customerId" TEXT,
    "clientName" TEXT,
    "projectName" TEXT NOT NULL,
    "projectType" "ConstructionProjectType" NOT NULL,
    "location" TEXT,
    "contractId" TEXT,
    "startDate" DATE,
    "expectedEndDate" DATE,
    "actualEndDate" DATE,
    "contractValue" DECIMAL(18,2),
    "budgetAmount" DECIMAL(18,2),
    "actualCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "billedAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "receivedAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL,
    "status" "ConstructionProjectStatus" NOT NULL DEFAULT 'PLANNED',
    "projectManagerId" TEXT,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "construction_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "construction_sites" (
    "id" TEXT NOT NULL,
    "siteCode" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "divisionId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "siteName" TEXT NOT NULL,
    "location" TEXT,
    "siteManagerId" TEXT,
    "status" "ConstructionSiteStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "construction_sites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "boq_items" (
    "id" TEXT NOT NULL,
    "boqCode" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "divisionId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "category" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL,
    "unitId" TEXT NOT NULL,
    "unitRate" DECIMAL(18,2) NOT NULL,
    "totalAmount" DECIMAL(18,2) NOT NULL,
    "costCode" TEXT,
    "status" "BOQItemStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "boq_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_material_issues" (
    "id" TEXT NOT NULL,
    "issueNumber" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "divisionId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "siteId" TEXT,
    "inventoryLocationId" TEXT NOT NULL,
    "issueDate" DATE NOT NULL,
    "status" "MaterialIssueStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "postedById" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "project_material_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_material_issue_lines" (
    "id" TEXT NOT NULL,
    "projectMaterialIssueId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL,
    "unitId" TEXT NOT NULL,
    "unitCost" DECIMAL(18,2),
    "totalCost" DECIMAL(18,2),
    "boqItemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_material_issue_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subcontractor_records" (
    "id" TEXT NOT NULL,
    "subcontractorCode" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "divisionId" TEXT NOT NULL,
    "projectId" TEXT,
    "supplierId" TEXT,
    "name" TEXT NOT NULL,
    "serviceDescription" TEXT,
    "contractValue" DECIMAL(18,2),
    "paidAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "outstandingAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "currency" TEXT,
    "status" "SubcontractorStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "subcontractor_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_progress_records" (
    "id" TEXT NOT NULL,
    "progressNumber" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "divisionId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "siteId" TEXT,
    "progressDate" DATE NOT NULL,
    "percentComplete" DECIMAL(5,2) NOT NULL,
    "description" TEXT NOT NULL,
    "reportedById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "status" "ProjectProgressStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "project_progress_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_billings" (
    "id" TEXT NOT NULL,
    "billingNumber" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "divisionId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "customerId" TEXT,
    "billingDate" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "ProjectBillingStatus" NOT NULL DEFAULT 'DRAFT',
    "salesOrderId" TEXT,
    "receivableId" TEXT,
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "project_billings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "itemba_work_units_companyId_workUnitCode_key" ON "itemba_work_units"("companyId", "workUnitCode");

-- CreateIndex
CREATE UNIQUE INDEX "equipment_usages_companyId_usageNumber_key" ON "equipment_usages"("companyId", "usageNumber");

-- CreateIndex
CREATE UNIQUE INDEX "labor_records_companyId_laborRecordNumber_key" ON "labor_records"("companyId", "laborRecordNumber");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_assignedDriverId_key" ON "vehicles"("assignedDriverId");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_companyId_vehicleCode_key" ON "vehicles"("companyId", "vehicleCode");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_companyId_registrationNumber_key" ON "vehicles"("companyId", "registrationNumber");

-- CreateIndex
CREATE UNIQUE INDEX "driver_profiles_companyId_driverCode_key" ON "driver_profiles"("companyId", "driverCode");

-- CreateIndex
CREATE UNIQUE INDEX "routes_companyId_routeCode_key" ON "routes"("companyId", "routeCode");

-- CreateIndex
CREATE UNIQUE INDEX "trips_companyId_tripNumber_key" ON "trips"("companyId", "tripNumber");

-- CreateIndex
CREATE UNIQUE INDEX "trip_expenses_companyId_tripExpenseNumber_key" ON "trip_expenses"("companyId", "tripExpenseNumber");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_maintenances_companyId_maintenanceNumber_key" ON "vehicle_maintenances"("companyId", "maintenanceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "farms_companyId_farmCode_key" ON "farms"("companyId", "farmCode");

-- CreateIndex
CREATE UNIQUE INDEX "farm_fields_farmId_fieldCode_key" ON "farm_fields"("farmId", "fieldCode");

-- CreateIndex
CREATE UNIQUE INDEX "crops_companyId_cropCode_key" ON "crops"("companyId", "cropCode");

-- CreateIndex
CREATE UNIQUE INDEX "crop_seasons_companyId_seasonCode_key" ON "crop_seasons"("companyId", "seasonCode");

-- CreateIndex
CREATE UNIQUE INDEX "farm_input_applications_companyId_applicationNumber_key" ON "farm_input_applications"("companyId", "applicationNumber");

-- CreateIndex
CREATE UNIQUE INDEX "harvest_records_companyId_harvestNumber_key" ON "harvest_records"("companyId", "harvestNumber");

-- CreateIndex
CREATE UNIQUE INDEX "agriculture_activities_companyId_activityNumber_key" ON "agriculture_activities"("companyId", "activityNumber");

-- CreateIndex
CREATE UNIQUE INDEX "construction_projects_companyId_projectCode_key" ON "construction_projects"("companyId", "projectCode");

-- CreateIndex
CREATE UNIQUE INDEX "construction_sites_projectId_siteCode_key" ON "construction_sites"("projectId", "siteCode");

-- CreateIndex
CREATE UNIQUE INDEX "boq_items_projectId_boqCode_key" ON "boq_items"("projectId", "boqCode");

-- CreateIndex
CREATE UNIQUE INDEX "project_material_issues_companyId_issueNumber_key" ON "project_material_issues"("companyId", "issueNumber");

-- CreateIndex
CREATE UNIQUE INDEX "subcontractor_records_companyId_subcontractorCode_key" ON "subcontractor_records"("companyId", "subcontractorCode");

-- CreateIndex
CREATE UNIQUE INDEX "project_progress_records_companyId_progressNumber_key" ON "project_progress_records"("companyId", "progressNumber");

-- CreateIndex
CREATE UNIQUE INDEX "project_billings_companyId_billingNumber_key" ON "project_billings"("companyId", "billingNumber");

-- AddForeignKey
ALTER TABLE "itemba_work_units" ADD CONSTRAINT "itemba_work_units_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itemba_work_units" ADD CONSTRAINT "itemba_work_units_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "divisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itemba_work_units" ADD CONSTRAINT "itemba_work_units_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itemba_work_units" ADD CONSTRAINT "itemba_work_units_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_usages" ADD CONSTRAINT "equipment_usages_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_usages" ADD CONSTRAINT "equipment_usages_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "divisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_usages" ADD CONSTRAINT "equipment_usages_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_usages" ADD CONSTRAINT "equipment_usages_fixedAssetId_fkey" FOREIGN KEY ("fixedAssetId") REFERENCES "fixed_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_usages" ADD CONSTRAINT "equipment_usages_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment_usages" ADD CONSTRAINT "equipment_usages_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "labor_records" ADD CONSTRAINT "labor_records_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "labor_records" ADD CONSTRAINT "labor_records_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "divisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "labor_records" ADD CONSTRAINT "labor_records_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "labor_records" ADD CONSTRAINT "labor_records_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "labor_records" ADD CONSTRAINT "labor_records_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "divisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_fixedAssetId_fkey" FOREIGN KEY ("fixedAssetId") REFERENCES "fixed_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_assignedDriverId_fkey" FOREIGN KEY ("assignedDriverId") REFERENCES "driver_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_profiles" ADD CONSTRAINT "driver_profiles_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_profiles" ADD CONSTRAINT "driver_profiles_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "divisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_profiles" ADD CONSTRAINT "driver_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_profiles" ADD CONSTRAINT "driver_profiles_assignedVehicleId_fkey" FOREIGN KEY ("assignedVehicleId") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routes" ADD CONSTRAINT "routes_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routes" ADD CONSTRAINT "routes_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "divisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "divisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "driver_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "routes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_cargoUnitId_fkey" FOREIGN KEY ("cargoUnitId") REFERENCES "units_of_measure"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trips" ADD CONSTRAINT "trips_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_expenses" ADD CONSTRAINT "trip_expenses_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_expenses" ADD CONSTRAINT "trip_expenses_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_expenses" ADD CONSTRAINT "trip_expenses_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "divisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_expenses" ADD CONSTRAINT "trip_expenses_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_fuel_usages" ADD CONSTRAINT "trip_fuel_usages_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_fuel_usages" ADD CONSTRAINT "trip_fuel_usages_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_fuel_usages" ADD CONSTRAINT "trip_fuel_usages_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "divisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_fuel_usages" ADD CONSTRAINT "trip_fuel_usages_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_fuel_usages" ADD CONSTRAINT "trip_fuel_usages_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_fuel_usages" ADD CONSTRAINT "trip_fuel_usages_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_maintenances" ADD CONSTRAINT "vehicle_maintenances_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_maintenances" ADD CONSTRAINT "vehicle_maintenances_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "divisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_maintenances" ADD CONSTRAINT "vehicle_maintenances_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_maintenances" ADD CONSTRAINT "vehicle_maintenances_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_maintenances" ADD CONSTRAINT "vehicle_maintenances_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "farms" ADD CONSTRAINT "farms_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "farms" ADD CONSTRAINT "farms_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "divisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "farms" ADD CONSTRAINT "farms_fixedAssetId_fkey" FOREIGN KEY ("fixedAssetId") REFERENCES "fixed_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "farms" ADD CONSTRAINT "farms_sizeUnitId_fkey" FOREIGN KEY ("sizeUnitId") REFERENCES "units_of_measure"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "farms" ADD CONSTRAINT "farms_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "farm_fields" ADD CONSTRAINT "farm_fields_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "farm_fields" ADD CONSTRAINT "farm_fields_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "divisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "farm_fields" ADD CONSTRAINT "farm_fields_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "farms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "farm_fields" ADD CONSTRAINT "farm_fields_sizeUnitId_fkey" FOREIGN KEY ("sizeUnitId") REFERENCES "units_of_measure"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crops" ADD CONSTRAINT "crops_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crops" ADD CONSTRAINT "crops_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "divisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crops" ADD CONSTRAINT "crops_defaultUnitId_fkey" FOREIGN KEY ("defaultUnitId") REFERENCES "units_of_measure"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crop_seasons" ADD CONSTRAINT "crop_seasons_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crop_seasons" ADD CONSTRAINT "crop_seasons_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "divisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crop_seasons" ADD CONSTRAINT "crop_seasons_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "farms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crop_seasons" ADD CONSTRAINT "crop_seasons_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "farm_fields"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crop_seasons" ADD CONSTRAINT "crop_seasons_cropId_fkey" FOREIGN KEY ("cropId") REFERENCES "crops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crop_seasons" ADD CONSTRAINT "crop_seasons_yieldUnitId_fkey" FOREIGN KEY ("yieldUnitId") REFERENCES "units_of_measure"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crop_seasons" ADD CONSTRAINT "crop_seasons_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "farm_input_applications" ADD CONSTRAINT "farm_input_applications_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "farm_input_applications" ADD CONSTRAINT "farm_input_applications_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "divisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "farm_input_applications" ADD CONSTRAINT "farm_input_applications_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "farms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "farm_input_applications" ADD CONSTRAINT "farm_input_applications_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "farm_fields"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "farm_input_applications" ADD CONSTRAINT "farm_input_applications_cropSeasonId_fkey" FOREIGN KEY ("cropSeasonId") REFERENCES "crop_seasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "farm_input_applications" ADD CONSTRAINT "farm_input_applications_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "farm_input_applications" ADD CONSTRAINT "farm_input_applications_inventoryLocationId_fkey" FOREIGN KEY ("inventoryLocationId") REFERENCES "inventory_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "farm_input_applications" ADD CONSTRAINT "farm_input_applications_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units_of_measure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "farm_input_applications" ADD CONSTRAINT "farm_input_applications_appliedById_fkey" FOREIGN KEY ("appliedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "farm_input_applications" ADD CONSTRAINT "farm_input_applications_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "harvest_records" ADD CONSTRAINT "harvest_records_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "harvest_records" ADD CONSTRAINT "harvest_records_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "divisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "harvest_records" ADD CONSTRAINT "harvest_records_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "farms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "harvest_records" ADD CONSTRAINT "harvest_records_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "farm_fields"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "harvest_records" ADD CONSTRAINT "harvest_records_cropSeasonId_fkey" FOREIGN KEY ("cropSeasonId") REFERENCES "crop_seasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "harvest_records" ADD CONSTRAINT "harvest_records_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "harvest_records" ADD CONSTRAINT "harvest_records_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units_of_measure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "harvest_records" ADD CONSTRAINT "harvest_records_inventoryLocationId_fkey" FOREIGN KEY ("inventoryLocationId") REFERENCES "inventory_locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "harvest_records" ADD CONSTRAINT "harvest_records_harvestedById_fkey" FOREIGN KEY ("harvestedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "harvest_records" ADD CONSTRAINT "harvest_records_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "harvest_records" ADD CONSTRAINT "harvest_records_postedById_fkey" FOREIGN KEY ("postedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "harvest_records" ADD CONSTRAINT "harvest_records_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agriculture_activities" ADD CONSTRAINT "agriculture_activities_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agriculture_activities" ADD CONSTRAINT "agriculture_activities_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "divisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agriculture_activities" ADD CONSTRAINT "agriculture_activities_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "farms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agriculture_activities" ADD CONSTRAINT "agriculture_activities_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "farm_fields"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agriculture_activities" ADD CONSTRAINT "agriculture_activities_cropSeasonId_fkey" FOREIGN KEY ("cropSeasonId") REFERENCES "crop_seasons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agriculture_activities" ADD CONSTRAINT "agriculture_activities_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "construction_projects" ADD CONSTRAINT "construction_projects_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "construction_projects" ADD CONSTRAINT "construction_projects_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "divisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "construction_projects" ADD CONSTRAINT "construction_projects_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "construction_projects" ADD CONSTRAINT "construction_projects_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "construction_projects" ADD CONSTRAINT "construction_projects_projectManagerId_fkey" FOREIGN KEY ("projectManagerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "construction_projects" ADD CONSTRAINT "construction_projects_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "construction_sites" ADD CONSTRAINT "construction_sites_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "construction_sites" ADD CONSTRAINT "construction_sites_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "divisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "construction_sites" ADD CONSTRAINT "construction_sites_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "construction_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "construction_sites" ADD CONSTRAINT "construction_sites_siteManagerId_fkey" FOREIGN KEY ("siteManagerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boq_items" ADD CONSTRAINT "boq_items_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boq_items" ADD CONSTRAINT "boq_items_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "divisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boq_items" ADD CONSTRAINT "boq_items_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "construction_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boq_items" ADD CONSTRAINT "boq_items_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units_of_measure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_material_issues" ADD CONSTRAINT "project_material_issues_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_material_issues" ADD CONSTRAINT "project_material_issues_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "divisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_material_issues" ADD CONSTRAINT "project_material_issues_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "construction_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_material_issues" ADD CONSTRAINT "project_material_issues_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "construction_sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_material_issues" ADD CONSTRAINT "project_material_issues_inventoryLocationId_fkey" FOREIGN KEY ("inventoryLocationId") REFERENCES "inventory_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_material_issues" ADD CONSTRAINT "project_material_issues_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_material_issues" ADD CONSTRAINT "project_material_issues_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_material_issues" ADD CONSTRAINT "project_material_issues_postedById_fkey" FOREIGN KEY ("postedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_material_issue_lines" ADD CONSTRAINT "project_material_issue_lines_projectMaterialIssueId_fkey" FOREIGN KEY ("projectMaterialIssueId") REFERENCES "project_material_issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_material_issue_lines" ADD CONSTRAINT "project_material_issue_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_material_issue_lines" ADD CONSTRAINT "project_material_issue_lines_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units_of_measure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_material_issue_lines" ADD CONSTRAINT "project_material_issue_lines_boqItemId_fkey" FOREIGN KEY ("boqItemId") REFERENCES "boq_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontractor_records" ADD CONSTRAINT "subcontractor_records_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontractor_records" ADD CONSTRAINT "subcontractor_records_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "divisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontractor_records" ADD CONSTRAINT "subcontractor_records_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "construction_projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subcontractor_records" ADD CONSTRAINT "subcontractor_records_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_progress_records" ADD CONSTRAINT "project_progress_records_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_progress_records" ADD CONSTRAINT "project_progress_records_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "divisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_progress_records" ADD CONSTRAINT "project_progress_records_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "construction_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_progress_records" ADD CONSTRAINT "project_progress_records_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "construction_sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_progress_records" ADD CONSTRAINT "project_progress_records_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_progress_records" ADD CONSTRAINT "project_progress_records_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_billings" ADD CONSTRAINT "project_billings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_billings" ADD CONSTRAINT "project_billings_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "divisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_billings" ADD CONSTRAINT "project_billings_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "construction_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_billings" ADD CONSTRAINT "project_billings_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_billings" ADD CONSTRAINT "project_billings_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_billings" ADD CONSTRAINT "project_billings_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
