import { IsString, IsOptional, IsBoolean, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateDeductionTypeDto {
  @IsString() name!: string;
  @IsString() companyId!: string;
  @IsString() code!: string;
  @IsOptional() @IsBoolean() statutory?: boolean;
  @IsOptional() @IsBoolean() recurring?: boolean;
  @IsOptional() @IsNumber() @Type(() => Number) defaultAmount?: number;
  @IsOptional() @IsNumber() @Type(() => Number) defaultPercentage?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
