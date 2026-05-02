import { IsString, IsOptional, IsEnum, IsNumber, IsDateString } from 'class-validator';
import { ProjectBillingStatus } from '@prisma/client';

export class CreateProjectBillingDto {
  @IsString() companyId!: string;
  @IsString() divisionId!: string;
  @IsString() projectId!: string;
  @IsString() @IsOptional() customerId?: string;
  @IsDateString() billingDate!: string;
  @IsString() description!: string;
  @IsNumber() amount!: number;
  @IsString() currency!: string;
  @IsEnum(ProjectBillingStatus) @IsOptional() status?: ProjectBillingStatus;
}
