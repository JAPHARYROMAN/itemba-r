import { IsIn, IsOptional } from 'class-validator';

/** Party linkage (Phase 3): `GET /supplier-payments/:id/remittance?format=pdf`. */
export class ExportRemittanceDto {
  @IsOptional()
  @IsIn(['pdf'])
  format?: 'pdf';
}
