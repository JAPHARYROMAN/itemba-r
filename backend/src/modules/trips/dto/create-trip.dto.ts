import { IsDateString, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateTripDto {
  @IsString()
  @IsNotEmpty()
  companyId!: string;

  @IsString()
  @IsNotEmpty()
  divisionId!: string;

  @IsString() @IsOptional() branchId?: string;
  @IsString() @IsOptional() customerId?: string;
  @IsString() @IsOptional() customerName?: string;

  @IsString()
  @IsNotEmpty()
  vehicleId!: string;

  @IsString()
  @IsNotEmpty()
  driverId!: string;

  @IsString() @IsOptional() routeId?: string;

  @IsString()
  @IsNotEmpty()
  origin!: string;

  @IsString()
  @IsNotEmpty()
  destination!: string;

  @IsString() @IsOptional() cargoDescription?: string;
  @IsNumber() @IsOptional() cargoWeight?: number;
  @IsString() @IsOptional() cargoUnitId?: string;

  @IsDateString()
  @IsNotEmpty()
  tripDate!: string;

  @IsDateString() @IsOptional() expectedReturnDate?: string;
  @IsNumber() @IsOptional() revenueAmount?: number;

  @IsString()
  @IsNotEmpty()
  currency!: string;

  @IsString() @IsOptional() notes?: string;
}
