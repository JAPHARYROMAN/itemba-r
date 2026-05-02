import { IsString, IsOptional, IsEnum, IsUUID, IsDateString } from 'class-validator';
import { TaskType, TaskPriority, TaskStatus } from '@prisma/client';

export class UpdateTaskDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsEnum(TaskType) taskType?: TaskType;
  @IsOptional() @IsEnum(TaskPriority) priority?: TaskPriority;
  @IsOptional() @IsEnum(TaskStatus) status?: TaskStatus;
  @IsOptional() @IsUUID() assignedToId?: string;
  @IsOptional() @IsUUID() assignedById?: string;
  @IsOptional() @IsDateString() dueDate?: string;
}
