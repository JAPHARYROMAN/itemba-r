import { IsOptional, IsEnum, IsUUID, IsInt, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PackageMovementType } from '@prisma/client';
import { Type } from 'class-transformer';

export class QueryPackageMovementDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() companyId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() customerId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() returnablePackageId?: string;
  @ApiPropertyOptional({ enum: PackageMovementType }) @IsOptional() @IsEnum(PackageMovementType) movementType?: PackageMovementType;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5000) limit?: number = 20;
}
