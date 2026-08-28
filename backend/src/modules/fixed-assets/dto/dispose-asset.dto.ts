import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { FixedAssetStatus } from '@prisma/client';

const DISPOSAL_STATUSES = [
  FixedAssetStatus.DISPOSED,
  FixedAssetStatus.SOLD,
  FixedAssetStatus.WRITTEN_OFF,
  FixedAssetStatus.LOST,
] as const;

export class DisposeAssetDto {
  @IsNotEmpty()
  @IsIn(DISPOSAL_STATUSES)
  disposalStatus!: (typeof DISPOSAL_STATUSES)[number];

  @IsNotEmpty() @IsString() disposalDate!: string;
  @IsOptional() @IsString() disposalValue?: string;
  @IsOptional() @IsString() notes?: string;
}
