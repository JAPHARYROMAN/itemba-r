import { CacheEntryType } from '@prisma/client';
import { IsDateString, IsEnum, IsObject, IsOptional, IsString, IsUUID } from 'class-validator';

export class SetCacheEntryDto {
  @IsString()
  cacheKey!: string;

  @IsOptional()
  @IsUUID()
  companyId?: string;

  @IsOptional()
  @IsString()
  scopeHash?: string;

  @IsOptional()
  @IsEnum(CacheEntryType)
  cacheType?: CacheEntryType;

  @IsObject()
  value!: Record<string, unknown>;

  @IsDateString()
  expiresAt!: string;
}
