import { PartialType } from '@nestjs/mapped-types';
import { CreateSalaryAdvanceDto } from './create-salary-advance.dto';
export class UpdateSalaryAdvanceDto extends PartialType(CreateSalaryAdvanceDto) {}
