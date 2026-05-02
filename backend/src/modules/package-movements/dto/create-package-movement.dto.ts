import { IsString, IsOptional, IsEnum, IsUUID, IsNumber, IsDateString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PackageMovementType } from '@prisma/client';

export class CreatePackageMovementDto {
  @ApiProperty() @IsUUID() companyId!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() customerId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() supplierId?: string;
  @ApiProperty() @IsUUID() returnablePackageId!: string;
  @ApiProperty({ enum: PackageMovementType }) @IsEnum(PackageMovementType) movementType!: PackageMovementType;
  @ApiProperty() @IsNumber() quantity!: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() depositAmount?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() referenceType?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() referenceId?: string;
  @ApiProperty() @IsDateString() movementDate!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}
