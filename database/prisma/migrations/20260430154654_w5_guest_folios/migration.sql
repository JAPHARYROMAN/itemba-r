-- CreateEnum
CREATE TYPE "GuestFolioStatus" AS ENUM ('OPEN', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FolioChargeType" AS ENUM ('ROOM', 'RESTAURANT', 'BAR', 'LAUNDRY', 'TELEPHONE', 'MINIBAR', 'OTHER');

-- CreateTable
CREATE TABLE "guest_folios" (
    "id" TEXT NOT NULL,
    "folioNumber" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "status" "GuestFolioStatus" NOT NULL DEFAULT 'OPEN',
    "subtotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'TZS',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "settlementSalesOrderId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "guest_folios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "folio_charges" (
    "id" TEXT NOT NULL,
    "folioId" TEXT NOT NULL,
    "chargeType" "FolioChargeType" NOT NULL,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(18,4) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "taxAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "postedById" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "folio_charges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "guest_folios_bookingId_key" ON "guest_folios"("bookingId");

-- CreateIndex
CREATE INDEX "guest_folios_companyId_status_idx" ON "guest_folios"("companyId", "status");

-- CreateIndex
CREATE INDEX "guest_folios_guestId_idx" ON "guest_folios"("guestId");

-- CreateIndex
CREATE UNIQUE INDEX "guest_folios_companyId_folioNumber_key" ON "guest_folios"("companyId", "folioNumber");

-- CreateIndex
CREATE INDEX "folio_charges_folioId_idx" ON "folio_charges"("folioId");

-- AddForeignKey
ALTER TABLE "guest_folios" ADD CONSTRAINT "guest_folios_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_folios" ADD CONSTRAINT "guest_folios_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "room_bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_folios" ADD CONSTRAINT "guest_folios_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "guests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_folios" ADD CONSTRAINT "guest_folios_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "folio_charges" ADD CONSTRAINT "folio_charges_folioId_fkey" FOREIGN KEY ("folioId") REFERENCES "guest_folios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "folio_charges" ADD CONSTRAINT "folio_charges_postedById_fkey" FOREIGN KEY ("postedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
