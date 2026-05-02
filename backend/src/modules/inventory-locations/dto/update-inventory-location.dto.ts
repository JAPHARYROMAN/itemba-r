import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';
import { InventoryLocationType } from '@prisma/client';

export class UpdateInventoryLocationDto {
  @IsOptional()
  @IsString()
  divisionId?: string;

  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @IsString()
  locationCode?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEnum(InventoryLocationType)
  locationType?: InventoryLocationType;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  responsibleUserId?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
