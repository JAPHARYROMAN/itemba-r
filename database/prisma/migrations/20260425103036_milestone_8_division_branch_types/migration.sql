-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "BranchType" ADD VALUE 'PARKING_FACILITY';
ALTER TYPE "BranchType" ADD VALUE 'HOSPITALITY_FACILITY';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DivisionType" ADD VALUE 'TRUCK_PARKING';
ALTER TYPE "DivisionType" ADD VALUE 'RENTAL_SHOPS';
ALTER TYPE "DivisionType" ADD VALUE 'HOSPITALITY';
ALTER TYPE "DivisionType" ADD VALUE 'REAL_ESTATE';
