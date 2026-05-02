import { IsString, IsOptional, IsEnum, IsNumber, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';
import { PropertyMaintenanceType, PropertyMaintenanceStatus } from '@prisma/client';

export class CreatePropertyMaintenanceDto {
  @IsString() maintenanceNumber!: string;
  @IsString() companyId!: string;
  @IsString() propertyId!: string;
  @IsDateString() maintenanceDate!: string;
  @IsEnum(PropertyMaintenanceType) maintenanceType!: PropertyMaintenanceType;
  @IsString() description!: string;
  @IsString() currency!: string;
  @IsEnum(PropertyMaintenanceStatus) @IsOptional() status?: PropertyMaintenanceStatus;
  @IsString() @IsOptional() rentalUnitId?: string;
  @IsString() @IsOptional() supplierId?: string;
  @IsNumber() @IsOptional() @Type(() => Number) costAmount?: number;
  @IsString() @IsOptional() expenseId?: string;
  @IsString() createdById!: string;
  @IsString() @IsOptional() completedById?: string;
  @IsString() @IsOptional() notes?: string;
}
