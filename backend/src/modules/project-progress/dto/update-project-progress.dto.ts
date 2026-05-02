import { PartialType } from '@nestjs/mapped-types';
import { CreateProjectProgressDto } from './create-project-progress.dto';
export class UpdateProjectProgressDto extends PartialType(CreateProjectProgressDto) {}
