import { OmitType, PartialType } from '@nestjs/mapped-types';
import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateJobQueueConfigDto {
  @IsString()
  queueName!: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  concurrency?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  retryAttempts?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  retryBackoffSeconds?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  timeoutSeconds?: number | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateJobQueueConfigDto extends PartialType(
  OmitType(CreateJobQueueConfigDto, ['queueName'] as const),
) {}
