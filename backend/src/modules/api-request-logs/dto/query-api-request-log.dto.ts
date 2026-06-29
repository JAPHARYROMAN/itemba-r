import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type, Transform } from 'class-transformer';

export class QueryApiRequestLogDto {
  @IsOptional()
  @IsString()
  apiClientId?: string;

  @IsOptional()
  @IsString()
  apiKeyId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  statusCode?: number;

  @IsOptional()
  // @Type(() => String) keeps the value a string under the global pipe's
  // enableImplicitConversion, which would otherwise coerce any non-empty string
  // (incl. 'false') to boolean `true` before @Transform runs.
  @Type(() => String)
  @Transform(({ value }) => value === 'true')
  @IsBoolean()
  rateLimited?: boolean;

  @IsOptional()
  @IsString()
  companyId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 20;
}
