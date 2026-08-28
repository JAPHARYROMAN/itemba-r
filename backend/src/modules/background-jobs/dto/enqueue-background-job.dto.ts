import { BackgroundJobPriority, BackgroundJobType } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

export class EnqueueBackgroundJobDto {
  @IsEnum(BackgroundJobType)
  jobType!: BackgroundJobType;

  @IsString()
  queueName!: string;

  @IsOptional()
  @IsUUID()
  companyId?: string;

  @IsOptional()
  @IsEnum(BackgroundJobPriority)
  priority?: BackgroundJobPriority;

  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxAttempts?: number;

  @IsOptional()
  @IsDateString()
  scheduledAt?: string;

  @IsOptional()
  @IsString()
  correlationId?: string;

  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}
