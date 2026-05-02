import { IsEnum, IsOptional, IsString } from 'class-validator';
import { BranchType } from '@prisma/client';

export class UpdateBranchDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsEnum(BranchType) type?: BranchType;
  @IsOptional() @IsString() location?: string;
}
