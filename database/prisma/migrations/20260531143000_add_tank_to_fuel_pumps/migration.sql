ALTER TABLE "fuel_pumps" ADD COLUMN "tankId" TEXT;

CREATE INDEX "fuel_pumps_tankId_idx" ON "fuel_pumps"("tankId");

ALTER TABLE "fuel_pumps"
  ADD CONSTRAINT "fuel_pumps_tankId_fkey"
  FOREIGN KEY ("tankId") REFERENCES "fuel_tanks"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
