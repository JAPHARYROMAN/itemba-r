import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { AssetCollateralStatus } from '@prisma/client';

export class MarkCollateralDto {
  @IsNotEmpty() @IsEnum(AssetCollateralStatus) collateralStatus!: AssetCollateralStatus;
  @IsOptional() @IsString() notes?: string;
}
