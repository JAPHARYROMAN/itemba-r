-- Optional product photo for Mobile POS tiles and the admin catalogue.
-- Additive only: nullable column, no backfill — existing rows stay NULL and
-- every read path treats a missing image as "no photo".

ALTER TABLE "products" ADD COLUMN "imageUrl" TEXT;
