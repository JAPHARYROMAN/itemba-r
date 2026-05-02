import { IsString, IsOptional, IsEnum, IsNumber, IsBoolean } from 'class-validator';
import { Type } from 'class-transformer';
import { MenuItemType } from '@prisma/client';

export class CreateMenuItemDto {
  @IsString() menuItemCode!: string;
  @IsString() companyId!: string;
  @IsString() menuCategoryId!: string;
  @IsString() name!: string;
  @IsNumber() @Type(() => Number) price!: number;
  @IsString() currency!: string;
  @IsEnum(MenuItemType) itemType!: MenuItemType;
  @IsBoolean() @IsOptional() isAlcoholic?: boolean;
  @IsBoolean() @IsOptional() trackInventory?: boolean;
  @IsBoolean() @IsOptional() isActive?: boolean;
  @IsString() @IsOptional() hospitalityFacilityId?: string;
  @IsString() @IsOptional() productId?: string;
  @IsString() @IsOptional() description?: string;
}
