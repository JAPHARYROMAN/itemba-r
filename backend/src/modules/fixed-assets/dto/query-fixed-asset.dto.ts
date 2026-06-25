import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import {
  AssetCollateralStatus, AssetFinancingStatus, AssetInsuranceStatus,
  AssetOwnershipLevel, FixedAssetCategory, FixedAssetStatus,
} from '@prisma/client';

export class QueryFixedAssetDto {
  @IsOptional() @IsString() companyId?: string;
  @IsOptional() @IsString() divisionId?: string;
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsEnum(AssetOwnershipLevel) ownershipLevel?: AssetOwnershipLevel;
  @IsOptional() @IsEnum(FixedAssetCategory) category?: FixedAssetCategory;
  @IsOptional() @IsEnum(FixedAssetStatus) status?: FixedAssetStatus;
  @IsOptional() @IsEnum(AssetCollateralStatus) collateralStatus?: AssetCollateralStatus;
  @IsOptional() @IsEnum(AssetInsuranceStatus) insuranceStatus?: AssetInsuranceStatus;
  @IsOptional() @IsEnum(AssetFinancingStatus) financingStatus?: AssetFinancingStatus;
  @IsOptional() @IsString() search?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5000) limit?: number = 20;
}
