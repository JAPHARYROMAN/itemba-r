import { IsString, IsOptional, IsEnum, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';
import { RestaurantTableStatus } from '@prisma/client';

export class CreateRestaurantTableDto {
  @IsString() tableCode!: string;
  @IsString() companyId!: string;
  @IsString() hospitalityFacilityId!: string;
  @IsString() tableNumber!: string;
  @IsEnum(RestaurantTableStatus) @IsOptional() status?: RestaurantTableStatus;
  @IsNumber() @IsOptional() @Type(() => Number) seatingCapacity?: number;
}
