-- returnablePackageId identifies a ReturnablePackage. The original Westsides
-- migration accidentally attached the same column to units_of_measure too,
-- making every valid package movement fail unless unrelated rows shared a UUID.
ALTER TABLE "package_movements"
DROP CONSTRAINT IF EXISTS "PackageMovement_unit_fk";
