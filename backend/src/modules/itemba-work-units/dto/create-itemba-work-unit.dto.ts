import { IsString, IsOptional, IsEnum, IsDateString } from 'class-validator';
import { ItembaWorkUnitType, ItembaWorkUnitStatus } from '@prisma/client';

export class CreateItembaWorkUnitDto {
  @IsString() companyId!: string;
  @IsString() divisionId!: string;
  @IsString() @IsOptional() branchId?: string;
  @IsString() workUnitCode!: string;
  @IsString() name!: string;
  @IsEnum(ItembaWorkUnitType) workUnitType!: ItembaWorkUnitType;
  @IsEnum(ItembaWorkUnitStatus) @IsOptional() status?: ItembaWorkUnitStatus;
  @IsString() @IsOptional() location?: string;
  @IsString() @IsOptional() managerId?: string;
  @IsDateString() @IsOptional() startDate?: string;
  @IsDateString() @IsOptional() endDate?: string;
  @IsString() @IsOptional() notes?: string;
}
