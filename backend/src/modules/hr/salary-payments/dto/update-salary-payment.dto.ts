import { PartialType } from '@nestjs/mapped-types';
import { CreateSalaryPaymentDto } from './create-salary-payment.dto';
export class UpdateSalaryPaymentDto extends PartialType(CreateSalaryPaymentDto) {}
