WITH linked_receivables AS (
  SELECT DISTINCT ON (so.id)
    so.id AS sales_order_id,
    r.id AS receivable_id,
    r."paidAmount" AS paid_amount,
    r."outstandingAmount" AS outstanding_amount
  FROM sales_orders so
  JOIN receivables r
    ON r."deletedAt" IS NULL
   AND (
     r.id = so."receivableId"
     OR (r."sourceType" = 'SalesOrder' AND r."sourceId" = so.id)
   )
  WHERE so."deletedAt" IS NULL
  ORDER BY
    so.id,
    CASE WHEN r.id = so."receivableId" THEN 0 ELSE 1 END,
    r."updatedAt" DESC
)
UPDATE sales_orders so
SET
  "receivableId" = COALESCE(so."receivableId", lr.receivable_id),
  "paidAmount" = lr.paid_amount,
  "outstandingAmount" = lr.outstanding_amount,
  "paymentStatus" = CASE
    WHEN lr.outstanding_amount <= 0 THEN 'PAID'
    WHEN lr.paid_amount > 0 THEN 'PARTIALLY_PAID'
    ELSE 'UNPAID'
  END::"PaymentStatus",
  "updatedAt" = NOW()
FROM linked_receivables lr
WHERE so.id = lr.sales_order_id
  AND (
    so."receivableId" IS DISTINCT FROM COALESCE(so."receivableId", lr.receivable_id)
    OR so."paidAmount" IS DISTINCT FROM lr.paid_amount
    OR so."outstandingAmount" IS DISTINCT FROM lr.outstanding_amount
    OR so."paymentStatus" IS DISTINCT FROM CASE
      WHEN lr.outstanding_amount <= 0 THEN 'PAID'
      WHEN lr.paid_amount > 0 THEN 'PARTIALLY_PAID'
      ELSE 'UNPAID'
    END::"PaymentStatus"
  );
