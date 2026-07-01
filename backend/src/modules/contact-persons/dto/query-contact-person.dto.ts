import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ContactEntityType } from '@prisma/client';

export class QueryContactPersonDto {
  @IsOptional() @IsString() companyId?: string;
  @IsOptional() @IsEnum(ContactEntityType) entityType?: ContactEntityType;
  @IsOptional() @IsString() entityId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5000) limit?: number = 20;
}
