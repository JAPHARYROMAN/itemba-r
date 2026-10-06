import {
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ReceiveFuelTankAllocationDto {
  @IsOptional()
  @IsString()
  purchaseOrderLineId?: string;

  @IsOptional()
  @IsString()
  productId?: string;

  @IsNotEmpty()
  @IsString()
  tankId!: string;

  @IsNotEmpty()
  @IsNumber()
  @Min(0.0001)
  quantity!: number;
}

export class ReceivePurchaseOrderDto {
  @IsOptional()
  @IsUUID()
  cashAccountId?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReceiveFuelTankAllocationDto)
  fuelTankAllocations?: ReceiveFuelTankAllocationDto[];
}
