-- AlterTable
ALTER TABLE "cash_desk_movements" ADD COLUMN     "expenseCategory" VARCHAR(40),
ADD COLUMN     "expenseNotes" VARCHAR(2000),
ADD COLUMN     "payee" VARCHAR(160);
ALTER TABLE "cash_desk_movements" ADD CONSTRAINT "cash_desk_expense_metadata" CHECK ("kind" = 'EXPENSE' OR ("expenseCategory" IS NULL AND "payee" IS NULL AND "expenseNotes" IS NULL));
ALTER TABLE "cash_desk_movements" ADD CONSTRAINT "cash_desk_expense_category" CHECK ("expenseCategory" IS NULL OR "expenseCategory" IN ('RENT','UTILITIES','TRANSPORT','FUEL','MEALS','OFFICE','MAINTENANCE','STAFF','FEES','TAXES','OTHER'));
