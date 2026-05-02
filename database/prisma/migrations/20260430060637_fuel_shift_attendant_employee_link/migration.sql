-- AlterTable
ALTER TABLE "fuel_shift_attendants" ADD COLUMN     "attendantName" TEXT,
ADD COLUMN     "employeeId" TEXT,
ALTER COLUMN "attendantId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "fuel_shift_attendants_employeeId_idx" ON "fuel_shift_attendants"("employeeId");

-- AddForeignKey
ALTER TABLE "fuel_shift_attendants" ADD CONSTRAINT "fuel_shift_attendants_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
