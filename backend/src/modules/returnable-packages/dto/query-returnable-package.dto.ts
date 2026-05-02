import { IsOptional, IsEnum, IsUUID, IsInt, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ReturnablePackageType, ReturnablePackageStatus } from '@prisma/client';
import { Type } from 'class-transformer';

export class QueryReturnablePackageDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() companyId?: string;
  @ApiPropertyOptional({ enum: ReturnablePackageType }) @IsOptional() @IsEnum(ReturnablePackageType) packageType?: ReturnablePackageType;
  @ApiPropertyOptional({ enum: ReturnablePackageStatus }) @IsOptional() @IsEnum(ReturnablePackageStatus) status?: ReturnablePackageStatus;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) limit?: number = 20;
}
