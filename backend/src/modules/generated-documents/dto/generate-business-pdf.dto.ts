import { IsIn, IsString } from 'class-validator';

export const BUSINESS_PDF_ENTITY_TYPES = [
  'SALES_ORDER',
  'QUOTATION',
  'PROFORMA_INVOICE',
  'DELIVERY_NOTE',
  'CUSTOMER_PROFILE',
] as const;

export type BusinessPdfEntityType = (typeof BUSINESS_PDF_ENTITY_TYPES)[number];

export class GenerateBusinessPdfDto {
  @IsIn(BUSINESS_PDF_ENTITY_TYPES)
  entityType!: BusinessPdfEntityType;

  @IsString()
  entityId!: string;
}
