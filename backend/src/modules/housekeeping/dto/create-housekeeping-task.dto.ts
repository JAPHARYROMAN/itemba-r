import { IsString, IsOptional, IsEnum, IsDateString } from 'class-validator';
import { HousekeepingTaskType, HousekeepingTaskStatus } from '@prisma/client';

export class CreateHousekeepingTaskDto {
  @IsString() taskNumber!: string;
  @IsString() companyId!: string;
  @IsString() hospitalityFacilityId!: string;
  @IsString() roomId!: string;
  @IsEnum(HousekeepingTaskType) taskType!: HousekeepingTaskType;
  @IsEnum(HousekeepingTaskStatus) @IsOptional() status?: HousekeepingTaskStatus;
  @IsString() createdById!: string;
  @IsString() @IsOptional() assignedToId?: string;
  @IsDateString() @IsOptional() scheduledAt?: string;
  @IsDateString() @IsOptional() completedAt?: string;
  @IsString() @IsOptional() notes?: string;
}
