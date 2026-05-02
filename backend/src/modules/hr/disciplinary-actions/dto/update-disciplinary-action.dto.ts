import { PartialType } from '@nestjs/mapped-types';
import { IsEnum, IsOptional } from 'class-validator';
import { DisciplinaryActionStatus } from '@prisma/client';
import { CreateDisciplinaryActionDto } from './create-disciplinary-action.dto';

export class UpdateDisciplinaryActionDto extends PartialType(CreateDisciplinaryActionDto) {
  @IsOptional() @IsEnum(DisciplinaryActionStatus) status?: DisciplinaryActionStatus;
}
