import { IsDateString, IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { EmploymentDisputeType } from '@prisma/client';

export class CreateEmploymentDisputeDto {
  @IsNotEmpty() @IsString() companyId!: string;
  @IsNotEmpty() @IsString() employeeId!: string;
  @IsNotEmpty() @IsEnum(EmploymentDisputeType) type!: EmploymentDisputeType;
  @IsNotEmpty() @IsDateString() raisedAt!: string;
  @IsNotEmpty() @IsString() summary!: string;
  @IsOptional() @IsString() initialPosition?: string;
  @IsOptional() @IsString() notes?: string;
}
