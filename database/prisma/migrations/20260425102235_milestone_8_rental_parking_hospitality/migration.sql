-- CreateEnum
CREATE TYPE "BusinessUnitType" AS ENUM ('TRUCK_PARKING', 'HOSPITALITY', 'GUEST_HOUSE', 'HOTEL', 'RESTAURANT', 'BAR', 'REAL_ESTATE_RENTAL', 'SHOPS_RENTAL', 'HOUSES_RENTAL', 'PETROLEUM', 'OTHER');

-- CreateEnum
CREATE TYPE "BusinessUnitStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "BusinessLicenseType" AS ENUM ('TRUCK_PARKING_LICENSE', 'HOTEL_LICENSE', 'GUEST_HOUSE_LICENSE', 'RESTAURANT_LICENSE', 'BAR_LICENSE', 'LIQUOR_LICENSE', 'BUSINESS_LICENSE', 'REAL_ESTATE_LICENSE', 'RENTAL_BUSINESS_LICENSE', 'FOOD_SERVICE_LICENSE', 'HEALTH_PERMIT', 'FIRE_SAFETY_CERTIFICATE', 'TOURISM_LICENSE', 'OTHER');

-- CreateEnum
CREATE TYPE "BusinessLicenseStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'PENDING_RENEWAL', 'SUSPENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RentalPropertyType" AS ENUM ('COMMERCIAL_BUILDING', 'SHOP_BLOCK', 'RESIDENTIAL_HOUSE', 'APARTMENT', 'MIXED_USE', 'LAND', 'OTHER');

-- CreateEnum
CREATE TYPE "RentalOwnershipType" AS ENUM ('OWNED', 'LEASED', 'MANAGED', 'RENTED', 'OTHER');

-- CreateEnum
CREATE TYPE "RentalPropertyStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'UNDER_MAINTENANCE', 'FULLY_OCCUPIED', 'VACANT', 'CLOSED');

-- CreateEnum
CREATE TYPE "RentalUnitType" AS ENUM ('SHOP', 'HOUSE', 'ROOM', 'APARTMENT', 'OFFICE', 'STORE', 'WAREHOUSE', 'OTHER');

-- CreateEnum
CREATE TYPE "RentalUnitStatus" AS ENUM ('VACANT', 'OCCUPIED', 'RESERVED', 'UNDER_MAINTENANCE', 'CLOSED');

-- CreateEnum
CREATE TYPE "BillingFrequency" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY', 'CUSTOM');

-- CreateEnum
CREATE TYPE "TenantType" AS ENUM ('INDIVIDUAL', 'COMPANY', 'ORGANIZATION', 'OTHER');

-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "LeaseStatus" AS ENUM ('DRAFT', 'ACTIVE', 'EXPIRED', 'TERMINATED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RentInvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED', 'WRITTEN_OFF');

-- CreateEnum
CREATE TYPE "PaymentMethodGeneral" AS ENUM ('CASH', 'MOBILE_MONEY', 'BANK_TRANSFER', 'BANK_CARD', 'CHEQUE', 'OTHER');

-- CreateEnum
CREATE TYPE "PropertyMaintenanceType" AS ENUM ('REPAIR', 'CLEANING', 'ELECTRICAL', 'PLUMBING', 'PAINTING', 'SECURITY', 'STRUCTURAL', 'OTHER');

-- CreateEnum
CREATE TYPE "PropertyMaintenanceStatus" AS ENUM ('REPORTED', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ParkingFacilityStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'FULL', 'UNDER_MAINTENANCE', 'CLOSED');

-- CreateEnum
CREATE TYPE "ParkingZoneVehicleType" AS ENUM ('LARGE_TRUCK', 'TRAILER', 'BUS', 'SMALL_TRUCK', 'CAR', 'OTHER');

-- CreateEnum
CREATE TYPE "ParkingZoneStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'FULL', 'CLOSED');

-- CreateEnum
CREATE TYPE "ParkingRateType" AS ENUM ('HOURLY', 'DAILY', 'OVERNIGHT', 'WEEKLY', 'MONTHLY', 'FLAT', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ParkingRateStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ParkingPaymentStatus" AS ENUM ('UNPAID', 'PARTIALLY_PAID', 'PAID');

-- CreateEnum
CREATE TYPE "ParkingSessionStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'CANCELLED', 'VOIDED');

-- CreateEnum
CREATE TYPE "ParkingPaymentMethod" AS ENUM ('CASH', 'MOBILE_MONEY', 'BANK_TRANSFER', 'BANK_CARD', 'CREDIT', 'OTHER');

-- CreateEnum
CREATE TYPE "HospitalityFacilityType" AS ENUM ('GUEST_HOUSE', 'HOTEL', 'RESTAURANT', 'BAR', 'MIXED_HOSPITALITY');

-- CreateEnum
CREATE TYPE "HospitalityFacilityStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'UNDER_MAINTENANCE', 'CLOSED');

-- CreateEnum
CREATE TYPE "RoomType" AS ENUM ('SINGLE', 'DOUBLE', 'TWIN', 'DELUXE', 'FAMILY', 'SUITE', 'OTHER');

-- CreateEnum
CREATE TYPE "RoomStatus" AS ENUM ('AVAILABLE', 'OCCUPIED', 'RESERVED', 'DIRTY', 'UNDER_MAINTENANCE', 'OUT_OF_SERVICE');

-- CreateEnum
CREATE TYPE "GuestStatus" AS ENUM ('ACTIVE', 'BLOCKED', 'INACTIVE');

-- CreateEnum
CREATE TYPE "BookingSource" AS ENUM ('WALK_IN', 'PHONE', 'ONLINE', 'COMPANY', 'AGENT', 'OTHER');

-- CreateEnum
CREATE TYPE "BookingPaymentStatus" AS ENUM ('UNPAID', 'PARTIALLY_PAID', 'PAID');

-- CreateEnum
CREATE TYPE "RoomBookingStatus" AS ENUM ('RESERVED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "HousekeepingTaskType" AS ENUM ('CLEANING', 'LAUNDRY', 'INSPECTION', 'MAINTENANCE', 'OTHER');

-- CreateEnum
CREATE TYPE "HousekeepingTaskStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MenuCategoryType" AS ENUM ('FOOD', 'NON_ALCOHOLIC_DRINK', 'ALCOHOLIC_DRINK', 'BAR_ITEM', 'SERVICE', 'OTHER');

-- CreateEnum
CREATE TYPE "MenuItemType" AS ENUM ('FOOD', 'DRINK', 'BAR_ITEM', 'SERVICE', 'OTHER');

-- CreateEnum
CREATE TYPE "RestaurantTableStatus" AS ENUM ('AVAILABLE', 'OCCUPIED', 'RESERVED', 'OUT_OF_SERVICE');

-- CreateEnum
CREATE TYPE "RestaurantOrderType" AS ENUM ('DINE_IN', 'TAKEAWAY', 'ROOM_SERVICE', 'BAR', 'DELIVERY', 'OTHER');

-- CreateEnum
CREATE TYPE "RestaurantOrderStatus" AS ENUM ('DRAFT', 'PLACED', 'PREPARING', 'SERVED', 'COMPLETED', 'CANCELLED', 'VOIDED');

-- CreateEnum
CREATE TYPE "RestaurantOrderPaymentStatus" AS ENUM ('UNPAID', 'PARTIALLY_PAID', 'PAID');

-- CreateEnum
CREATE TYPE "HospitalityPaymentContextType" AS ENUM ('ROOM_BOOKING', 'RESTAURANT_ORDER', 'BAR_ORDER', 'GENERAL');

-- CreateEnum
CREATE TYPE "HospitalityPaymentMethod" AS ENUM ('CASH', 'MOBILE_MONEY', 'BANK_TRANSFER', 'BANK_CARD', 'CREDIT', 'OTHER');

-- CreateTable
CREATE TABLE "licensed_business_units" (
    "id" TEXT NOT NULL,
    "businessUnitCode" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "divisionId" TEXT,
    "branchId" TEXT,
    "name" TEXT NOT NULL,
    "tradingName" TEXT,
    "businessUnitType" "BusinessUnitType" NOT NULL,
    "licenseRequired" BOOLEAN NOT NULL DEFAULT false,
    "primaryLicenseId" TEXT,
    "status" "BusinessUnitStatus" NOT NULL DEFAULT 'ACTIVE',
    "location" TEXT,
    "managerId" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "licensed_business_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_licenses" (
    "id" TEXT NOT NULL,
    "licenseCode" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "divisionId" TEXT,
    "licensedBusinessUnitId" TEXT,
    "licenseType" "BusinessLicenseType" NOT NULL,
    "licenseNumber" TEXT NOT NULL,
    "issuingAuthority" TEXT,
    "issueDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "renewalDate" TIMESTAMP(3),
    "status" "BusinessLicenseStatus" NOT NULL DEFAULT 'ACTIVE',
    "documentId" TEXT,
    "responsibleUserId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "business_licenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rental_properties" (
    "id" TEXT NOT NULL,
    "propertyCode" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "divisionId" TEXT,
    "branchId" TEXT,
    "licensedBusinessUnitId" TEXT,
    "fixedAssetId" TEXT,
    "propertyName" TEXT NOT NULL,
    "propertyType" "RentalPropertyType" NOT NULL,
    "location" TEXT NOT NULL,
    "ownershipType" "RentalOwnershipType" NOT NULL,
    "status" "RentalPropertyStatus" NOT NULL DEFAULT 'ACTIVE',
    "managerId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "rental_properties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rental_units" (
    "id" TEXT NOT NULL,
    "unitCode" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "unitType" "RentalUnitType" NOT NULL,
    "unitNumber" TEXT NOT NULL,
    "floor" TEXT,
    "sizeDescription" TEXT,
    "rentAmount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TZS',
    "billingFrequency" "BillingFrequency" NOT NULL,
    "securityDepositAmount" DECIMAL(18,2),
    "status" "RentalUnitStatus" NOT NULL DEFAULT 'VACANT',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "rental_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "tenantCode" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "tenantType" "TenantType" NOT NULL DEFAULT 'INDIVIDUAL',
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "tin" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "contactPerson" TEXT,
    "identificationType" TEXT,
    "identificationNumber" TEXT,
    "status" "TenantStatus" NOT NULL DEFAULT 'ACTIVE',
    "customerId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lease_agreements" (
    "id" TEXT NOT NULL,
    "leaseCode" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "rentalUnitId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contractId" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "rentAmount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TZS',
    "billingFrequency" "BillingFrequency" NOT NULL,
    "securityDepositAmount" DECIMAL(18,2),
    "securityDepositPaid" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "paymentTerms" TEXT,
    "status" "LeaseStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "lease_agreements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rent_invoices" (
    "id" TEXT NOT NULL,
    "rentInvoiceNumber" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "rentalUnitId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "leaseAgreementId" TEXT NOT NULL,
    "invoiceDate" TIMESTAMP(3) NOT NULL,
    "billingPeriodStart" TIMESTAMP(3) NOT NULL,
    "billingPeriodEnd" TIMESTAMP(3) NOT NULL,
    "rentAmount" DECIMAL(18,2) NOT NULL,
    "penaltyAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(18,2) NOT NULL,
    "paidAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "outstandingAmount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TZS',
    "dueDate" TIMESTAMP(3),
    "status" "RentInvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "receivableId" TEXT,
    "createdById" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "rent_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rent_payments" (
    "id" TEXT NOT NULL,
    "rentPaymentNumber" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "rentInvoiceId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "paymentDate" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TZS',
    "paymentMethod" "PaymentMethodGeneral" NOT NULL,
    "cashAccountId" TEXT,
    "reference" TEXT,
    "receivedById" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "rent_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_maintenances" (
    "id" TEXT NOT NULL,
    "maintenanceNumber" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "rentalUnitId" TEXT,
    "maintenanceDate" TIMESTAMP(3) NOT NULL,
    "maintenanceType" "PropertyMaintenanceType" NOT NULL,
    "description" TEXT NOT NULL,
    "supplierId" TEXT,
    "costAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'TZS',
    "status" "PropertyMaintenanceStatus" NOT NULL DEFAULT 'REPORTED',
    "expenseId" TEXT,
    "createdById" TEXT NOT NULL,
    "completedById" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "property_maintenances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parking_facilities" (
    "id" TEXT NOT NULL,
    "facilityCode" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "divisionId" TEXT,
    "branchId" TEXT,
    "licensedBusinessUnitId" TEXT,
    "facilityName" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "capacityTrucks" INTEGER,
    "status" "ParkingFacilityStatus" NOT NULL DEFAULT 'ACTIVE',
    "managerId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "parking_facilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parking_zones" (
    "id" TEXT NOT NULL,
    "zoneCode" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "zoneName" TEXT NOT NULL,
    "vehicleType" "ParkingZoneVehicleType" NOT NULL,
    "capacity" INTEGER,
    "status" "ParkingZoneStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "parking_zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parking_rates" (
    "id" TEXT NOT NULL,
    "rateCode" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "zoneId" TEXT,
    "rateName" TEXT NOT NULL,
    "rateType" "ParkingRateType" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TZS',
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "status" "ParkingRateStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "parking_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parking_sessions" (
    "id" TEXT NOT NULL,
    "sessionNumber" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "zoneId" TEXT,
    "customerId" TEXT,
    "truckNumber" TEXT NOT NULL,
    "trailerNumber" TEXT,
    "driverName" TEXT,
    "driverPhone" TEXT,
    "companyName" TEXT,
    "entryTime" TIMESTAMP(3) NOT NULL,
    "exitTime" TIMESTAMP(3),
    "rateId" TEXT,
    "calculatedAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "paidAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "outstandingAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'TZS',
    "paymentStatus" "ParkingPaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "status" "ParkingSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "receivableId" TEXT,
    "salesOrderId" TEXT,
    "createdById" TEXT NOT NULL,
    "closedById" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "parking_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parking_payments" (
    "id" TEXT NOT NULL,
    "paymentNumber" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "parkingSessionId" TEXT NOT NULL,
    "paymentDate" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TZS',
    "paymentMethod" "ParkingPaymentMethod" NOT NULL,
    "cashAccountId" TEXT,
    "reference" TEXT,
    "receivedById" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "parking_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hospitality_facilities" (
    "id" TEXT NOT NULL,
    "facilityCode" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "divisionId" TEXT,
    "branchId" TEXT,
    "licensedBusinessUnitId" TEXT,
    "facilityName" TEXT NOT NULL,
    "facilityType" "HospitalityFacilityType" NOT NULL,
    "location" TEXT NOT NULL,
    "status" "HospitalityFacilityStatus" NOT NULL DEFAULT 'ACTIVE',
    "managerId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "hospitality_facilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rooms" (
    "id" TEXT NOT NULL,
    "roomCode" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "hospitalityFacilityId" TEXT NOT NULL,
    "roomNumber" TEXT NOT NULL,
    "roomType" "RoomType" NOT NULL,
    "floor" TEXT,
    "defaultRate" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TZS',
    "maxOccupancy" INTEGER,
    "status" "RoomStatus" NOT NULL DEFAULT 'AVAILABLE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guests" (
    "id" TEXT NOT NULL,
    "guestCode" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "customerId" TEXT,
    "fullName" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "nationality" TEXT,
    "identificationType" TEXT,
    "identificationNumber" TEXT,
    "address" TEXT,
    "status" "GuestStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "guests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "room_bookings" (
    "id" TEXT NOT NULL,
    "bookingNumber" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "hospitalityFacilityId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "bookingDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expectedCheckIn" TIMESTAMP(3) NOT NULL,
    "expectedCheckOut" TIMESTAMP(3) NOT NULL,
    "actualCheckIn" TIMESTAMP(3),
    "actualCheckOut" TIMESTAMP(3),
    "nights" INTEGER NOT NULL DEFAULT 1,
    "ratePerNight" DECIMAL(18,2) NOT NULL,
    "subtotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "paidAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "outstandingAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'TZS',
    "bookingSource" "BookingSource" NOT NULL DEFAULT 'WALK_IN',
    "paymentStatus" "BookingPaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "status" "RoomBookingStatus" NOT NULL DEFAULT 'RESERVED',
    "receivableId" TEXT,
    "salesOrderId" TEXT,
    "createdById" TEXT NOT NULL,
    "checkedInById" TEXT,
    "checkedOutById" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "room_bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "housekeeping_tasks" (
    "id" TEXT NOT NULL,
    "taskNumber" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "hospitalityFacilityId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "taskType" "HousekeepingTaskType" NOT NULL,
    "status" "HousekeepingTaskStatus" NOT NULL DEFAULT 'PENDING',
    "assignedToId" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "housekeeping_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_categories" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "hospitalityFacilityId" TEXT,
    "name" TEXT NOT NULL,
    "categoryType" "MenuCategoryType" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "menu_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_items" (
    "id" TEXT NOT NULL,
    "menuItemCode" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "hospitalityFacilityId" TEXT,
    "menuCategoryId" TEXT NOT NULL,
    "productId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TZS',
    "itemType" "MenuItemType" NOT NULL,
    "isAlcoholic" BOOLEAN NOT NULL DEFAULT false,
    "trackInventory" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "menu_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "restaurant_tables" (
    "id" TEXT NOT NULL,
    "tableCode" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "hospitalityFacilityId" TEXT NOT NULL,
    "tableNumber" TEXT NOT NULL,
    "seatingCapacity" INTEGER,
    "status" "RestaurantTableStatus" NOT NULL DEFAULT 'AVAILABLE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "restaurant_tables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "restaurant_orders" (
    "id" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "hospitalityFacilityId" TEXT NOT NULL,
    "tableId" TEXT,
    "guestId" TEXT,
    "customerId" TEXT,
    "orderType" "RestaurantOrderType" NOT NULL,
    "orderDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "subtotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "paidAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "outstandingAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'TZS',
    "paymentStatus" "RestaurantOrderPaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "status" "RestaurantOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "waiterId" TEXT,
    "cashierId" TEXT,
    "receivableId" TEXT,
    "salesOrderId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "restaurant_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "restaurant_order_lines" (
    "id" TEXT NOT NULL,
    "restaurantOrderId" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "productId" TEXT,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unitPrice" DECIMAL(18,2) NOT NULL,
    "discountAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(18,2) NOT NULL,
    "inventoryLocationId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "restaurant_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hospitality_payments" (
    "id" TEXT NOT NULL,
    "paymentNumber" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "paymentContextType" "HospitalityPaymentContextType" NOT NULL,
    "paymentContextId" TEXT NOT NULL,
    "paymentDate" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TZS',
    "paymentMethod" "HospitalityPaymentMethod" NOT NULL,
    "cashAccountId" TEXT,
    "reference" TEXT,
    "receivedById" TEXT NOT NULL,
    "roomBookingId" TEXT,
    "restaurantOrderId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "hospitality_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_unit_attachments" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "licensedBusinessUnitId" TEXT,
    "propertyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_unit_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "licensed_business_units_companyId_businessUnitCode_key" ON "licensed_business_units"("companyId", "businessUnitCode");

-- CreateIndex
CREATE UNIQUE INDEX "business_licenses_companyId_licenseCode_key" ON "business_licenses"("companyId", "licenseCode");

-- CreateIndex
CREATE UNIQUE INDEX "rental_properties_companyId_propertyCode_key" ON "rental_properties"("companyId", "propertyCode");

-- CreateIndex
CREATE UNIQUE INDEX "rental_units_propertyId_unitCode_key" ON "rental_units"("propertyId", "unitCode");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_companyId_tenantCode_key" ON "tenants"("companyId", "tenantCode");

-- CreateIndex
CREATE UNIQUE INDEX "lease_agreements_companyId_leaseCode_key" ON "lease_agreements"("companyId", "leaseCode");

-- CreateIndex
CREATE UNIQUE INDEX "rent_invoices_companyId_rentInvoiceNumber_key" ON "rent_invoices"("companyId", "rentInvoiceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "rent_payments_companyId_rentPaymentNumber_key" ON "rent_payments"("companyId", "rentPaymentNumber");

-- CreateIndex
CREATE UNIQUE INDEX "property_maintenances_companyId_maintenanceNumber_key" ON "property_maintenances"("companyId", "maintenanceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "parking_facilities_companyId_facilityCode_key" ON "parking_facilities"("companyId", "facilityCode");

-- CreateIndex
CREATE UNIQUE INDEX "parking_zones_facilityId_zoneCode_key" ON "parking_zones"("facilityId", "zoneCode");

-- CreateIndex
CREATE UNIQUE INDEX "parking_rates_companyId_rateCode_key" ON "parking_rates"("companyId", "rateCode");

-- CreateIndex
CREATE UNIQUE INDEX "parking_sessions_companyId_sessionNumber_key" ON "parking_sessions"("companyId", "sessionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "parking_payments_companyId_paymentNumber_key" ON "parking_payments"("companyId", "paymentNumber");

-- CreateIndex
CREATE UNIQUE INDEX "hospitality_facilities_companyId_facilityCode_key" ON "hospitality_facilities"("companyId", "facilityCode");

-- CreateIndex
CREATE UNIQUE INDEX "rooms_hospitalityFacilityId_roomCode_key" ON "rooms"("hospitalityFacilityId", "roomCode");

-- CreateIndex
CREATE UNIQUE INDEX "guests_companyId_guestCode_key" ON "guests"("companyId", "guestCode");

-- CreateIndex
CREATE UNIQUE INDEX "room_bookings_companyId_bookingNumber_key" ON "room_bookings"("companyId", "bookingNumber");

-- CreateIndex
CREATE UNIQUE INDEX "housekeeping_tasks_companyId_taskNumber_key" ON "housekeeping_tasks"("companyId", "taskNumber");

-- CreateIndex
CREATE UNIQUE INDEX "menu_items_companyId_menuItemCode_key" ON "menu_items"("companyId", "menuItemCode");

-- CreateIndex
CREATE UNIQUE INDEX "restaurant_tables_companyId_tableCode_key" ON "restaurant_tables"("companyId", "tableCode");

-- CreateIndex
CREATE UNIQUE INDEX "restaurant_orders_companyId_orderNumber_key" ON "restaurant_orders"("companyId", "orderNumber");

-- CreateIndex
CREATE UNIQUE INDEX "hospitality_payments_companyId_paymentNumber_key" ON "hospitality_payments"("companyId", "paymentNumber");

-- AddForeignKey
ALTER TABLE "licensed_business_units" ADD CONSTRAINT "licensed_business_units_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "licensed_business_units" ADD CONSTRAINT "licensed_business_units_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "divisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "licensed_business_units" ADD CONSTRAINT "licensed_business_units_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "licensed_business_units" ADD CONSTRAINT "licensed_business_units_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_licenses" ADD CONSTRAINT "business_licenses_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_licenses" ADD CONSTRAINT "business_licenses_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "divisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_licenses" ADD CONSTRAINT "business_licenses_licensedBusinessUnitId_fkey" FOREIGN KEY ("licensedBusinessUnitId") REFERENCES "licensed_business_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_licenses" ADD CONSTRAINT "business_licenses_responsibleUserId_fkey" FOREIGN KEY ("responsibleUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_properties" ADD CONSTRAINT "rental_properties_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_properties" ADD CONSTRAINT "rental_properties_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "divisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_properties" ADD CONSTRAINT "rental_properties_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_properties" ADD CONSTRAINT "rental_properties_licensedBusinessUnitId_fkey" FOREIGN KEY ("licensedBusinessUnitId") REFERENCES "licensed_business_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_properties" ADD CONSTRAINT "rental_properties_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_units" ADD CONSTRAINT "rental_units_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_units" ADD CONSTRAINT "rental_units_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "rental_properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lease_agreements" ADD CONSTRAINT "lease_agreements_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lease_agreements" ADD CONSTRAINT "lease_agreements_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "rental_properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lease_agreements" ADD CONSTRAINT "lease_agreements_rentalUnitId_fkey" FOREIGN KEY ("rentalUnitId") REFERENCES "rental_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lease_agreements" ADD CONSTRAINT "lease_agreements_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lease_agreements" ADD CONSTRAINT "lease_agreements_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lease_agreements" ADD CONSTRAINT "lease_agreements_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rent_invoices" ADD CONSTRAINT "rent_invoices_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rent_invoices" ADD CONSTRAINT "rent_invoices_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "rental_properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rent_invoices" ADD CONSTRAINT "rent_invoices_rentalUnitId_fkey" FOREIGN KEY ("rentalUnitId") REFERENCES "rental_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rent_invoices" ADD CONSTRAINT "rent_invoices_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rent_invoices" ADD CONSTRAINT "rent_invoices_leaseAgreementId_fkey" FOREIGN KEY ("leaseAgreementId") REFERENCES "lease_agreements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rent_invoices" ADD CONSTRAINT "rent_invoices_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rent_payments" ADD CONSTRAINT "rent_payments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rent_payments" ADD CONSTRAINT "rent_payments_rentInvoiceId_fkey" FOREIGN KEY ("rentInvoiceId") REFERENCES "rent_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rent_payments" ADD CONSTRAINT "rent_payments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rent_payments" ADD CONSTRAINT "rent_payments_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_maintenances" ADD CONSTRAINT "property_maintenances_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_maintenances" ADD CONSTRAINT "property_maintenances_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "rental_properties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_maintenances" ADD CONSTRAINT "property_maintenances_rentalUnitId_fkey" FOREIGN KEY ("rentalUnitId") REFERENCES "rental_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_maintenances" ADD CONSTRAINT "property_maintenances_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_maintenances" ADD CONSTRAINT "property_maintenances_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_maintenances" ADD CONSTRAINT "property_maintenances_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parking_facilities" ADD CONSTRAINT "parking_facilities_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parking_facilities" ADD CONSTRAINT "parking_facilities_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "divisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parking_facilities" ADD CONSTRAINT "parking_facilities_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parking_facilities" ADD CONSTRAINT "parking_facilities_licensedBusinessUnitId_fkey" FOREIGN KEY ("licensedBusinessUnitId") REFERENCES "licensed_business_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parking_facilities" ADD CONSTRAINT "parking_facilities_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parking_zones" ADD CONSTRAINT "parking_zones_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parking_zones" ADD CONSTRAINT "parking_zones_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "parking_facilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parking_rates" ADD CONSTRAINT "parking_rates_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parking_rates" ADD CONSTRAINT "parking_rates_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "parking_facilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parking_rates" ADD CONSTRAINT "parking_rates_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "parking_zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parking_rates" ADD CONSTRAINT "parking_rates_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parking_rates" ADD CONSTRAINT "parking_rates_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parking_sessions" ADD CONSTRAINT "parking_sessions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parking_sessions" ADD CONSTRAINT "parking_sessions_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "parking_facilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parking_sessions" ADD CONSTRAINT "parking_sessions_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "parking_zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parking_sessions" ADD CONSTRAINT "parking_sessions_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parking_sessions" ADD CONSTRAINT "parking_sessions_rateId_fkey" FOREIGN KEY ("rateId") REFERENCES "parking_rates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parking_sessions" ADD CONSTRAINT "parking_sessions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parking_sessions" ADD CONSTRAINT "parking_sessions_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parking_payments" ADD CONSTRAINT "parking_payments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parking_payments" ADD CONSTRAINT "parking_payments_parkingSessionId_fkey" FOREIGN KEY ("parkingSessionId") REFERENCES "parking_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parking_payments" ADD CONSTRAINT "parking_payments_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hospitality_facilities" ADD CONSTRAINT "hospitality_facilities_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hospitality_facilities" ADD CONSTRAINT "hospitality_facilities_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "divisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hospitality_facilities" ADD CONSTRAINT "hospitality_facilities_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hospitality_facilities" ADD CONSTRAINT "hospitality_facilities_licensedBusinessUnitId_fkey" FOREIGN KEY ("licensedBusinessUnitId") REFERENCES "licensed_business_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hospitality_facilities" ADD CONSTRAINT "hospitality_facilities_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_hospitalityFacilityId_fkey" FOREIGN KEY ("hospitalityFacilityId") REFERENCES "hospitality_facilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guests" ADD CONSTRAINT "guests_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guests" ADD CONSTRAINT "guests_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_bookings" ADD CONSTRAINT "room_bookings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_bookings" ADD CONSTRAINT "room_bookings_hospitalityFacilityId_fkey" FOREIGN KEY ("hospitalityFacilityId") REFERENCES "hospitality_facilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_bookings" ADD CONSTRAINT "room_bookings_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_bookings" ADD CONSTRAINT "room_bookings_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "guests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_bookings" ADD CONSTRAINT "room_bookings_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_bookings" ADD CONSTRAINT "room_bookings_checkedInById_fkey" FOREIGN KEY ("checkedInById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_bookings" ADD CONSTRAINT "room_bookings_checkedOutById_fkey" FOREIGN KEY ("checkedOutById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "housekeeping_tasks" ADD CONSTRAINT "housekeeping_tasks_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "housekeeping_tasks" ADD CONSTRAINT "housekeeping_tasks_hospitalityFacilityId_fkey" FOREIGN KEY ("hospitalityFacilityId") REFERENCES "hospitality_facilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "housekeeping_tasks" ADD CONSTRAINT "housekeeping_tasks_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "housekeeping_tasks" ADD CONSTRAINT "housekeeping_tasks_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "housekeeping_tasks" ADD CONSTRAINT "housekeeping_tasks_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_categories" ADD CONSTRAINT "menu_categories_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_categories" ADD CONSTRAINT "menu_categories_hospitalityFacilityId_fkey" FOREIGN KEY ("hospitalityFacilityId") REFERENCES "hospitality_facilities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_hospitalityFacilityId_fkey" FOREIGN KEY ("hospitalityFacilityId") REFERENCES "hospitality_facilities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_menuCategoryId_fkey" FOREIGN KEY ("menuCategoryId") REFERENCES "menu_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_tables" ADD CONSTRAINT "restaurant_tables_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_tables" ADD CONSTRAINT "restaurant_tables_hospitalityFacilityId_fkey" FOREIGN KEY ("hospitalityFacilityId") REFERENCES "hospitality_facilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_orders" ADD CONSTRAINT "restaurant_orders_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_orders" ADD CONSTRAINT "restaurant_orders_hospitalityFacilityId_fkey" FOREIGN KEY ("hospitalityFacilityId") REFERENCES "hospitality_facilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_orders" ADD CONSTRAINT "restaurant_orders_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "restaurant_tables"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_orders" ADD CONSTRAINT "restaurant_orders_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "guests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_orders" ADD CONSTRAINT "restaurant_orders_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_orders" ADD CONSTRAINT "restaurant_orders_waiterId_fkey" FOREIGN KEY ("waiterId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_orders" ADD CONSTRAINT "restaurant_orders_cashierId_fkey" FOREIGN KEY ("cashierId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_order_lines" ADD CONSTRAINT "restaurant_order_lines_restaurantOrderId_fkey" FOREIGN KEY ("restaurantOrderId") REFERENCES "restaurant_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_order_lines" ADD CONSTRAINT "restaurant_order_lines_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "menu_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_order_lines" ADD CONSTRAINT "restaurant_order_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hospitality_payments" ADD CONSTRAINT "hospitality_payments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hospitality_payments" ADD CONSTRAINT "hospitality_payments_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hospitality_payments" ADD CONSTRAINT "hospitality_payments_roomBookingId_fkey" FOREIGN KEY ("roomBookingId") REFERENCES "room_bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hospitality_payments" ADD CONSTRAINT "hospitality_payments_restaurantOrderId_fkey" FOREIGN KEY ("restaurantOrderId") REFERENCES "restaurant_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_unit_attachments" ADD CONSTRAINT "business_unit_attachments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_unit_attachments" ADD CONSTRAINT "business_unit_attachments_licensedBusinessUnitId_fkey" FOREIGN KEY ("licensedBusinessUnitId") REFERENCES "licensed_business_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_unit_attachments" ADD CONSTRAINT "business_unit_attachments_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "rental_properties"("id") ON DELETE SET NULL ON UPDATE CASCADE;
