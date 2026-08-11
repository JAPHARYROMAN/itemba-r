import {
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';

export class SaveDailyCloseDto {
  @IsString()
  @IsNotEmpty()
  companyId!: string;

  @IsOptional()
  @IsString()
  branchId?: string;

  @IsDateString()
  closeDate!: string;

  /** Counted amount per payment-method key, exactly as entered on the close screen. */
  @IsObject()
  countedByMethod!: Record<string, number>;

  @IsNumber()
  expectedTotal!: number;

  @IsNumber()
  countedTotal!: number;

  @IsNumber()
  varianceTotal!: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
