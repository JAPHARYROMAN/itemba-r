import { IsString, IsOptional, IsNumber, IsDateString, IsEnum, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { PerformanceRating, PerformanceRecordStatus } from '@prisma/client';

export class CreatePerformanceRecordDto {
  @IsString() performanceNumber!: string;
  @IsString() employeeId!: string;
  @IsString() companyId!: string;
  @IsString() reviewerId!: string;
  @IsDateString() reviewDate!: string;
  @IsOptional() @IsDateString() reviewPeriodStart?: string;
  @IsOptional() @IsDateString() reviewPeriodEnd?: string;
  @IsOptional() @IsNumber() @Type(() => Number) score?: number;
  @IsOptional() @IsEnum(PerformanceRating) rating?: PerformanceRating;
  @IsOptional() @IsString() strengths?: string;
  @IsOptional() @IsString() weaknesses?: string;
  @IsOptional() @IsString() recommendations?: string;
  @IsOptional() @IsEnum(PerformanceRecordStatus) status?: PerformanceRecordStatus;
  /** Optional bonus to grant on approval. Auto-creates an EmployeeAllowance. */
  @IsOptional() @IsNumber() @Type(() => Number) @Min(0) bonusAmount?: number;
}
