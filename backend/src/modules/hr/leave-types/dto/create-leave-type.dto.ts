import { IsString, IsOptional, IsBoolean, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateLeaveTypeDto {
  @IsString() name!: string;
  @IsString() companyId!: string;
  @IsString() code!: string;
  @IsOptional() @IsBoolean() paid?: boolean;
  @IsOptional() @IsNumber() @Type(() => Number) annualAllowanceDays?: number;
  @IsOptional() @IsBoolean() carryForwardAllowed?: boolean;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
