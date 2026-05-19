import { IsString, IsOptional, IsEnum, IsNumber, IsNotEmpty } from 'class-validator';
import { Type } from 'class-transformer';
import { PositionType, PositionStatus } from '@prisma/client';

export class CreatePositionDto {
  @IsOptional() @IsString() positionCode?: string;
  @IsString() @IsNotEmpty() companyId!: string;
  @IsString() @IsNotEmpty() departmentId!: string;
  @IsString() @IsNotEmpty() title!: string;
  @IsOptional() @IsEnum(PositionType) positionType?: PositionType;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsNumber() @Type(() => Number) defaultSalary?: number;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsEnum(PositionStatus) status?: PositionStatus;
}
