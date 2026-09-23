import { IsOptional, IsUUID, IsDateString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class QueryReportDto {
  @ApiProperty() @IsUUID() companyId!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() branchId?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() dateFrom?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() dateTo?: string;
}

/** Inventory snapshots support division scope without widening unrelated reports. */
export class QueryInventoryReportDto extends QueryReportDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() divisionId?: string;
}
