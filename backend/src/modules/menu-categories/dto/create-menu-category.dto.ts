import { IsString, IsOptional, IsEnum, IsBoolean } from 'class-validator';
import { MenuCategoryType } from '@prisma/client';

export class CreateMenuCategoryDto {
  @IsString() companyId!: string;
  @IsString() name!: string;
  @IsEnum(MenuCategoryType) categoryType!: MenuCategoryType;
  @IsBoolean() @IsOptional() isActive?: boolean;
  @IsString() @IsOptional() hospitalityFacilityId?: string;
}
