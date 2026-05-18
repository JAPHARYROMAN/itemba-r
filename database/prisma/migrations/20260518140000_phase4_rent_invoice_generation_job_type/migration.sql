-- Phase 4: add RENT_INVOICE_GENERATION to BackgroundJobType enum for the
-- recurring rent-invoice generation handler.
ALTER TYPE "BackgroundJobType" ADD VALUE IF NOT EXISTS 'RENT_INVOICE_GENERATION';
