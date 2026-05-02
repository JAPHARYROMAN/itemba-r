import { IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { FolioChargeType } from '@prisma/client';

export class PostFolioChargeDto {
  @IsEnum(FolioChargeType)
  chargeType!: FolioChargeType;

  @IsString()
  description!: string;

  @IsNumber()
  @Min(0)
  quantity!: number;

  @IsNumber()
  @Min(0)
  unitPrice!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  taxAmount?: number;

  @IsOptional()
  @IsString()
  sourceType?: string;

  @IsOptional()
  @IsString()
  sourceId?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
