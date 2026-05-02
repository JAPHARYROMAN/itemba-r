import { PartialType } from '@nestjs/mapped-types';
import { CreateRentPaymentDto } from './create-rent-payment.dto';
export class UpdateRentPaymentDto extends PartialType(CreateRentPaymentDto) {}
