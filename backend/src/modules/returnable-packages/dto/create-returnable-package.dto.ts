import { IsString, IsOptional, IsEnum, IsUUID, IsNumber } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ReturnablePackageType } from '@prisma/client';

export class CreateReturnablePackageDto {
  @ApiProperty() @IsUUID() companyId!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() productId?: string;
  @ApiProperty({ enum: ReturnablePackageType }) @IsEnum(ReturnablePackageType) packageType!: ReturnablePackageType;
  @ApiProperty() @IsString() name!: string;
  @ApiProperty() @IsNumber() depositValue!: number;
  @ApiPropertyOptional() @IsOptional() @IsUUID() unitId?: string;
}
