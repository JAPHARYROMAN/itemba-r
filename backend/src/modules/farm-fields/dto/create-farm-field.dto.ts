import { IsString, IsOptional, IsEnum, IsNumber } from 'class-validator';
import { FarmFieldStatus } from '@prisma/client';

export class CreateFarmFieldDto {
  @IsString() fieldCode!: string;
  @IsString() companyId!: string;
  @IsString() divisionId!: string;
  @IsString() farmId!: string;
  @IsString() name!: string;
  @IsNumber() @IsOptional() sizeValue?: number;
  @IsString() @IsOptional() sizeUnitId?: string;
  @IsString() @IsOptional() soilType?: string;
  @IsString() @IsOptional() irrigationType?: string;
  @IsEnum(FarmFieldStatus) @IsOptional() status?: FarmFieldStatus;
  @IsString() @IsOptional() notes?: string;
}
