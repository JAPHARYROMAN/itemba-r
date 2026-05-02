import { PartialType } from '@nestjs/mapped-types';
import { IsOptional, IsString } from 'class-validator';
import { GenerateReconciliationDto } from './generate-reconciliation.dto';

export class UpdateReconciliationDto extends PartialType(GenerateReconciliationDto) {
  @IsOptional()
  @IsString()
  notes?: string;
}
