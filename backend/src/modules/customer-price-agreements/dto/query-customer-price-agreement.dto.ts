import { IsOptional, IsEnum, IsUUID, IsInt, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { CustomerPriceAgreementStatus } from '@prisma/client';
import { Type } from 'class-transformer';

export class QueryCustomerPriceAgreementDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() companyId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() customerId?: string;
  @ApiPropertyOptional({ enum: CustomerPriceAgreementStatus }) @IsOptional() @IsEnum(CustomerPriceAgreementStatus) status?: CustomerPriceAgreementStatus;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) limit?: number = 20;
}
