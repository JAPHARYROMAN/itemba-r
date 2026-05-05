import { IsBoolean, IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { BranchType } from '@prisma/client';

export class CreateBranchDto {
  @IsUUID() divisionId!: string;
  @IsString() name!: string;
  @IsString() code!: string;
  @IsEnum(BranchType) type!: BranchType;
  @IsOptional() @IsString() location?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
