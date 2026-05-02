import { IsString, IsOptional, IsEnum, IsNumber, IsDateString } from 'class-validator';
import { TripExpenseType } from '@prisma/client';

export class CreateTripExpenseDto {
  @IsString() tripId!: string;
  @IsString() companyId!: string;
  @IsString() divisionId!: string;
  @IsEnum(TripExpenseType) expenseType!: TripExpenseType;
  @IsNumber() amount!: number;
  @IsString() currency!: string;
  @IsDateString() expenseDate!: string;
  @IsString() @IsOptional() description?: string;
  @IsString() @IsOptional() expenseId?: string;
}
