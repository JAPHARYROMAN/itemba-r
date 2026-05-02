import { IsString, IsOptional, IsEnum, IsNumber } from 'class-validator';
import { BOQItemStatus } from '@prisma/client';

export class CreateBOQItemDto {
  @IsString() companyId!: string;
  @IsString() divisionId!: string;
  @IsString() projectId!: string;
  @IsString() @IsOptional() category?: string;
  @IsString() description!: string;
  @IsNumber() quantity!: number;
  @IsString() unitId!: string;
  @IsNumber() unitRate!: number;
  @IsString() @IsOptional() costCode?: string;
  @IsEnum(BOQItemStatus) @IsOptional() status?: BOQItemStatus;
}
