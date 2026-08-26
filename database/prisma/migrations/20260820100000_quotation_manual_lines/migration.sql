-- Quotation lines may name an item the catalogue does not carry yet.
--
-- A quotation is a pre-sale document: the customer wants a price for something,
-- and requiring every item to exist as a Product first turns "write a quote"
-- into a data-entry task. These four changes let a line stand on free text.
--
-- Nothing downstream loosens. "productId" keeps its foreign key — NULL simply
-- satisfies it — so a line that DOES name a product still cannot name one that
-- does not exist. And QuotationsService.convertToSalesOrder refuses to convert
-- while any line is ad-hoc, because sales_order_lines."productId" is NOT NULL
-- and confirmation issues stock and posts COGS against a real product.
--
-- Safe on a live table: DROP NOT NULL and ADD COLUMN ... NULL are catalogue-only
-- in PostgreSQL 11+. They take a brief ACCESS EXCLUSIVE lock and rewrite no
-- rows, so existing quotation lines keep their productId and unitId untouched.
-- Reversing it needs backfill first, since old rows would violate NOT NULL.

ALTER TABLE "quotation_lines" ALTER COLUMN "productId" DROP NOT NULL;
ALTER TABLE "quotation_lines" ALTER COLUMN "unitId" DROP NOT NULL;
ALTER TABLE "quotation_lines" ADD COLUMN "itemName" TEXT;
ALTER TABLE "quotation_lines" ADD COLUMN "unitLabel" TEXT;
