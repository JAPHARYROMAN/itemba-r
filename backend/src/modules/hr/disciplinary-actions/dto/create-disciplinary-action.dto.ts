import { IsDateString, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { DisciplinaryActionType } from '@prisma/client';

export class CreateDisciplinaryActionDto {
  @IsNotEmpty() @IsString() companyId!: string;
  @IsNotEmpty() @IsString() employeeId!: string;
  @IsOptional() @IsString() disputeId?: string;
  @IsNotEmpty() @IsEnum(DisciplinaryActionType) type!: DisciplinaryActionType;
  @IsNotEmpty() @IsDateString() issuedAt!: string;
  @IsOptional() @IsDateString() effectiveFrom?: string;
  @IsOptional() @IsDateString() effectiveTo?: string;
  @IsNotEmpty() @IsString() reason!: string;
  @IsOptional() @IsString() evidence?: string;
  @IsOptional() @IsString() employeeResponse?: string;
  @IsOptional() @IsString() notes?: string;
  /** Optional financial fine. When > 0, an EmployeeDeduction is auto-created. */
  @IsOptional() @IsNumber() @Min(0) fineAmount?: number;
}
