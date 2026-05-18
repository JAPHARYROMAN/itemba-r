import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { SequenceResetFrequency } from '@prisma/client';

export class QueryDocumentNumberSequenceDto {
  @IsOptional()
  @IsString()
  companyId?: string;

  @IsOptional()
  @IsString()
  entityType?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 20;
}

export class CreateDocumentNumberSequenceDto {
  @IsOptional()
  @IsString()
  companyId?: string;

  @IsString()
  sequenceCode!: string;

  @IsString()
  entityType!: string;

  @IsOptional()
  @IsString()
  prefix?: string;

  @IsOptional()
  @IsString()
  suffix?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  padding?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  startNumber?: number;

  @IsOptional()
  @IsEnum(SequenceResetFrequency)
  resetFrequency?: SequenceResetFrequency;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateDocumentNumberSequenceDto {
  @IsOptional()
  @IsString()
  prefix?: string;

  @IsOptional()
  @IsString()
  suffix?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  padding?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  currentNumber?: number;

  @IsOptional()
  @IsEnum(SequenceResetFrequency)
  resetFrequency?: SequenceResetFrequency;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
