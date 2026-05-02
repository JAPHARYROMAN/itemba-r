import { IsString, IsOptional, IsBoolean, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateAllowanceTypeDto {
  @IsString() name!: string;
  @IsString() companyId!: string;
  @IsString() code!: string;
  @IsOptional() @IsBoolean() taxable?: boolean;
  @IsOptional() @IsBoolean() recurring?: boolean;
  @IsOptional() @IsNumber() @Type(() => Number) defaultAmount?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
