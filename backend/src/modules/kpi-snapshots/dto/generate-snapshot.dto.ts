import { IsString, IsOptional, IsEnum, IsArray, IsDateString } from 'class-validator';
import { SnapshotPeriodType } from '@prisma/client';

export class GenerateSnapshotDto {
  @IsArray()
  @IsString({ each: true })
  kpiIndicatorIds!: string[];

  @IsOptional()
  @IsString()
  companyId?: string;

  @IsOptional()
  @IsString()
  divisionId?: string;

  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @IsString()
  licensedBusinessUnitId?: string;

  @IsEnum(SnapshotPeriodType)
  periodType!: SnapshotPeriodType;

  @IsDateString()
  periodStart!: Date;

  @IsDateString()
  periodEnd!: Date;
}
