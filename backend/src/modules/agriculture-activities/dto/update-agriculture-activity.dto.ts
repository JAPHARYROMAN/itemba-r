import { PartialType } from '@nestjs/mapped-types';
import { CreateAgricultureActivityDto } from './create-agriculture-activity.dto';
export class UpdateAgricultureActivityDto extends PartialType(CreateAgricultureActivityDto) {}
