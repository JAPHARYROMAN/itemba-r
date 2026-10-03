import { IsDateString, IsIn, IsOptional, IsString } from 'class-validator';

/** Party linkage (Phase 3): `GET /tax/transactions/by-party`. */
export class TaxByPartyQueryDto {
  @IsString()
  companyId!: string;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @IsOptional()
  @IsIn(['OUTPUT', 'INPUT', 'WITHHELD', 'PAYABLE'])
  direction?: 'OUTPUT' | 'INPUT' | 'WITHHELD' | 'PAYABLE';
}
