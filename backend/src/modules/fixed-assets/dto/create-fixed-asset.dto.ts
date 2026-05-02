import { IsEnum, IsInt, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import {
  AssetCollateralStatus, AssetCondition, AssetFinancingStatus,
  AssetInsuranceStatus, AssetOwnershipLevel,
  CurrencyCode, FixedAssetCategory, FixedAssetStatus,
} from '@prisma/client';

export class CreateFixedAssetDto {
  @IsNotEmpty() @IsEnum(AssetOwnershipLevel) ownershipLevel!: AssetOwnershipLevel;
  @IsOptional() @IsString() companyId?: string;
  @IsOptional() @IsString() groupId?: string;
  @IsOptional() @IsString() divisionId?: string;
  @IsOptional() @IsString() branchId?: string;
  @IsNotEmpty() @IsString() assetCode!: string;
  @IsNotEmpty() @IsString() name!: string;
  @IsNotEmpty() @IsEnum(FixedAssetCategory) category!: FixedAssetCategory;
  @IsOptional() @IsString() description?: string;
  @IsNotEmpty() @IsString() acquisitionDate!: string;
  @IsNotEmpty() @IsString() acquisitionCost!: string;
  @IsOptional() @IsEnum(CurrencyCode) currency?: CurrencyCode;
  @IsNotEmpty() @IsString() currentBookValue!: string;
  @IsOptional() @IsString() depreciationRate?: string;
  @IsOptional() @IsInt() usefulLifeYears?: number;
  @IsOptional() @IsString() residualValue?: string;
  @IsOptional() @IsString() serialNumber?: string;
  @IsOptional() @IsString() make?: string;
  @IsOptional() @IsString() model?: string;
  @IsOptional() @IsString() registrationNo?: string;
  @IsOptional() @IsString() location?: string;
  @IsOptional() @IsEnum(AssetCondition) condition?: AssetCondition;
  @IsOptional() @IsEnum(AssetFinancingStatus) financingStatus?: AssetFinancingStatus;
  @IsOptional() @IsEnum(AssetCollateralStatus) collateralStatus?: AssetCollateralStatus;
  @IsOptional() @IsEnum(AssetInsuranceStatus) insuranceStatus?: AssetInsuranceStatus;
  @IsOptional() @IsEnum(FixedAssetStatus) status?: FixedAssetStatus;
  @IsOptional() @IsString() notes?: string;
}
