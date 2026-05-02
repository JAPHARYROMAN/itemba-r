import { IsString, IsOptional, IsEnum, IsBoolean, IsUUID, IsObject } from 'class-validator';
import { ControlType, EnforcementLevel } from '@prisma/client';

export class CreateInternalControlDto {
  @IsString() name!: string;
  @IsOptional() @IsString() description?: string;
  @IsEnum(ControlType) controlType!: ControlType;
  @IsOptional() @IsEnum(EnforcementLevel) enforcementLevel?: EnforcementLevel;
  @IsOptional() @IsUUID() companyId?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsString() entityType?: string;
  @IsOptional() @IsObject() condition?: Record<string, any>;
}
