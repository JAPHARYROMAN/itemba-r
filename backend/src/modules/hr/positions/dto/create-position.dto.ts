import { IsString, IsOptional, IsEnum, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';
import { PositionType, PositionStatus } from '@prisma/client';

export class CreatePositionDto {
  @IsString() positionCode!: string;
  @IsString() companyId!: string;
  @IsOptional() @IsString() departmentId?: string;
  @IsString() title!: string;
  @IsOptional() @IsEnum(PositionType) positionType?: PositionType;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsNumber() @Type(() => Number) defaultSalary?: number;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsEnum(PositionStatus) status?: PositionStatus;
}
