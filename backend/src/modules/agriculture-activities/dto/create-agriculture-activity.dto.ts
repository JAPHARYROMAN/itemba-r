import { IsString, IsOptional, IsEnum, IsNumber, IsDateString } from 'class-validator';
import { AgricultureActivityType, AgricultureActivityStatus } from '@prisma/client';

export class CreateAgricultureActivityDto {
  @IsString() companyId!: string;
  @IsString() divisionId!: string;
  @IsString() farmId!: string;
  @IsString() @IsOptional() fieldId?: string;
  @IsString() @IsOptional() cropSeasonId?: string;
  @IsEnum(AgricultureActivityType) activityType!: AgricultureActivityType;
  @IsDateString() activityDate!: string;
  @IsString() description!: string;
  @IsNumber() @IsOptional() costAmount?: number;
  @IsString() @IsOptional() currency?: string;
  @IsEnum(AgricultureActivityStatus) @IsOptional() status?: AgricultureActivityStatus;
}
