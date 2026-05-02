import { IsString, IsOptional, IsEnum, IsNumber } from 'class-validator';
import { CropType, CropStatus } from '@prisma/client';

export class CreateCropDto {
  @IsString() cropCode!: string;
  @IsString() companyId!: string;
  @IsString() divisionId!: string;
  @IsString() name!: string;
  @IsEnum(CropType) cropType!: CropType;
  @IsNumber() @IsOptional() defaultGrowingDays?: number;
  @IsString() @IsOptional() defaultUnitId?: string;
  @IsEnum(CropStatus) @IsOptional() status?: CropStatus;
  @IsString() @IsOptional() notes?: string;
}
