import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ExternalMessageChannel, ExternalMessageStatus } from '@prisma/client';

export class QueryExternalMessageDto {
  @IsOptional()
  @IsString()
  companyId?: string;

  @IsOptional()
  @IsEnum(ExternalMessageChannel)
  channel?: ExternalMessageChannel;

  @IsOptional()
  @IsEnum(ExternalMessageStatus)
  status?: ExternalMessageStatus;

  @IsOptional()
  @IsString()
  providerId?: string;

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
