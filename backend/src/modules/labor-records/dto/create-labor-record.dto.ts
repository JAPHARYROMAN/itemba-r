import { IsString, IsOptional, IsEnum, IsDateString, IsNumber, Min } from 'class-validator';
import { LaborContextType, LaborPaymentStatus } from '@prisma/client';

export class CreateLaborRecordDto {
  @IsString() companyId!: string;
  @IsString() divisionId!: string;
  @IsString() @IsOptional() branchId?: string;
  @IsEnum(LaborContextType) @IsOptional() laborContextType?: LaborContextType;
  @IsString() @IsOptional() laborContextId?: string;
  @IsString() @IsOptional() workerId?: string;
  @IsString() @IsOptional() workerName?: string;
  @IsDateString() laborDate!: string;
  @IsString() @IsOptional() role?: string;
  @IsNumber() @IsOptional() @Min(0) hoursWorked?: number;
  @IsNumber() @IsOptional() @Min(0) dayRate?: number;
  @IsNumber() @Min(0) totalAmount!: number;
  @IsString() currency!: string;
  @IsEnum(LaborPaymentStatus) @IsOptional() paymentStatus?: LaborPaymentStatus;
  @IsString() @IsOptional() notes?: string;
}
