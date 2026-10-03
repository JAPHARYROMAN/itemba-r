import { IsIn, IsOptional } from 'class-validator';

/** Party linkage (Phase 3): `GET /supplier-statements/:id/export?format=pdf|csv`. */
export class ExportSupplierStatementDto {
  @IsOptional()
  @IsIn(['pdf', 'csv'])
  format?: 'pdf' | 'csv';
}
