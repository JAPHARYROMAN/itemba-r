import { PartialType } from '@nestjs/mapped-types';
import { CreateHousekeepingTaskDto } from './create-housekeeping-task.dto';
export class UpdateHousekeepingTaskDto extends PartialType(CreateHousekeepingTaskDto) {}
