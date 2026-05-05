import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';
import { BranchType } from '@prisma/client';

export class UpdateBranchDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsEnum(BranchType) type?: BranchType;
  @IsOptional() @IsString() location?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
