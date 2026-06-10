import { IsString, IsNumber, IsOptional, IsDateString, Min } from 'class-validator';

export class CreateFuelCreditSaleDto {
  @IsOptional()
  @IsString()
  fuelShiftId?: string;

  @IsString()
  companyId!: string;

  @IsString()
  branchId!: string;

  @IsString()
  customerId!: string;

  @IsString()
  productId!: string;

  @IsOptional()
  @IsString()
  vehicleNumber?: string;

  @IsOptional()
  @IsString()
  driverName?: string;

  @IsNumber()
  @Min(0.001)
  litres!: number;

  @IsNumber()
  @Min(0.001)
  pricePerLitre!: number;

  @IsNumber()
  @Min(0.001)
  totalAmount!: number;

  @IsDateString()
  saleDate!: string;

  @IsOptional()
  @IsString()
  salesOrderId?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
