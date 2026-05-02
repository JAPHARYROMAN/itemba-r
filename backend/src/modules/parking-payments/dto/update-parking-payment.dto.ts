import { PartialType } from '@nestjs/mapped-types';
import { CreateParkingPaymentDto } from './create-parking-payment.dto';
export class UpdateParkingPaymentDto extends PartialType(CreateParkingPaymentDto) {}
