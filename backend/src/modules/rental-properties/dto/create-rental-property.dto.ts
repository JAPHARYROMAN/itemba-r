import { IsString, IsOptional, IsEnum } from 'class-validator';
import { RentalPropertyType, RentalOwnershipType, RentalPropertyStatus } from '@prisma/client';

export class CreateRentalPropertyDto {
  @IsString() propertyCode!: string;
  @IsString() companyId!: string;
  @IsString() propertyName!: string;
  @IsEnum(RentalPropertyType) propertyType!: RentalPropertyType;
  @IsString() location!: string;
  @IsEnum(RentalOwnershipType) ownershipType!: RentalOwnershipType;
  @IsEnum(RentalPropertyStatus) @IsOptional() status?: RentalPropertyStatus;
  @IsString() @IsOptional() divisionId?: string;
  @IsString() @IsOptional() branchId?: string;
  @IsString() @IsOptional() licensedBusinessUnitId?: string;
  @IsString() @IsOptional() fixedAssetId?: string;
  @IsString() @IsOptional() managerId?: string;
  @IsString() @IsOptional() notes?: string;
}
