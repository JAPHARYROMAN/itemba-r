import { IsDateString, IsEnum, IsOptional } from 'class-validator';

export enum FixedAssetCapitalizationSource {
  CASH = 'CASH',
  PAYABLE = 'PAYABLE',
}

export class CapitalizeFixedAssetDto {
  @IsOptional()
  @IsEnum(FixedAssetCapitalizationSource)
  source?: FixedAssetCapitalizationSource;

  @IsOptional()
  @IsDateString()
  transactionDate?: string;
}
