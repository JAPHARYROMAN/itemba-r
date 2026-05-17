import { IsDateString, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';
import { InventoryMovementType } from '@prisma/client';

export class CreateMovementDto {
  @IsNotEmpty() @IsString() companyId!: string;
  @IsOptional() @IsString() divisionId?: string;
  @IsNotEmpty() @IsString() branchId!: string;
  @IsNotEmpty() @IsString() productId!: string;
  @IsNotEmpty() @IsEnum(InventoryMovementType) movementType!: InventoryMovementType;
  @IsNotEmpty() @IsNumber() quantity!: number;
  @IsNotEmpty() @IsString() unitId!: string;
  @IsOptional() @IsNumber() unitCost?: number;
  @IsNotEmpty() @IsDateString() movementDate!: string;
  @IsOptional() @IsString() referenceType?: string;
  @IsOptional() @IsString() referenceId?: string;
  @IsOptional() @IsString() batchNumber?: string;
  @IsOptional() @IsDateString() expiryDate?: string;
  @IsOptional() @IsString() notes?: string;
}
