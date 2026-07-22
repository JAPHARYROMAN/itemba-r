import { IsIn, IsString } from 'class-validator';

export const BUSINESS_PDF_ENTITY_TYPES = [
  'SALES_ORDER',
  'PURCHASE_ORDER',
  'SUPPLIER_ORDER_DRAFT',
  'QUOTATION',
  'PROFORMA_INVOICE',
  'DELIVERY_NOTE',
  'CUSTOMER_PROFILE',
  'CUSTOMER_DEBT_STATEMENT',
  'GOODS_RECEIVED_NOTE',
  'SUPPLIER_INVOICE',
  'PAYSLIP',
  'CREDIT_NOTE',
  'CUSTOMER_PAYMENT_RECEIPT',
] as const;

export type BusinessPdfEntityType = (typeof BUSINESS_PDF_ENTITY_TYPES)[number];

export class GenerateBusinessPdfDto {
  @IsIn(BUSINESS_PDF_ENTITY_TYPES)
  entityType!: BusinessPdfEntityType;

  @IsString()
  entityId!: string;
}
