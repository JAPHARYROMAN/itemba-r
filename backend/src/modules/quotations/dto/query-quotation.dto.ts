import { IsOptional, IsEnum, IsUUID, IsInt, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { QuotationType, QuotationStatus } from '@prisma/client';
import { Type } from 'class-transformer';

export class QueryQuotationDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() companyId?: string;
  @ApiPropertyOptional({ enum: QuotationStatus }) @IsOptional() @IsEnum(QuotationStatus) status?: QuotationStatus;
  @ApiPropertyOptional() @IsOptional() @IsUUID() customerId?: string;
  @ApiPropertyOptional({ enum: QuotationType }) @IsOptional() @IsEnum(QuotationType) quotationType?: QuotationType;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) limit?: number = 20;
}
