import { OmitType, PartialType } from '@nestjs/mapped-types';
import { IsDateString, IsOptional } from 'class-validator';
import { CreateEmployeeAllowanceDto } from './create-employee-allowance.dto';
export class UpdateEmployeeAllowanceDto extends PartialType(
  OmitType(CreateEmployeeAllowanceDto, ['effectiveTo'] as const),
) {
  @IsOptional() @IsDateString() effectiveTo?: string | null;
}
