import { OmitType, PartialType } from '@nestjs/mapped-types';
import { IsDateString, IsOptional } from 'class-validator';
import { CreateEmployeeDeductionDto } from './create-employee-deduction.dto';
export class UpdateEmployeeDeductionDto extends PartialType(
  OmitType(CreateEmployeeDeductionDto, ['effectiveTo'] as const),
) {
  @IsOptional() @IsDateString() effectiveTo?: string | null;
}
