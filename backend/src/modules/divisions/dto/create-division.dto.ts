import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { DivisionType } from '@prisma/client';

export class CreateDivisionDto {
  @IsUUID() companyId!: string;
  @IsString() name!: string;
  @IsString() code!: string;
  @IsEnum(DivisionType) type!: DivisionType;
  @IsOptional() @IsString() description?: string;
}
