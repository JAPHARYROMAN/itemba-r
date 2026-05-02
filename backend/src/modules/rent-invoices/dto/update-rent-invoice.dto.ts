import { PartialType } from '@nestjs/mapped-types';
import { CreateRentInvoiceDto } from './create-rent-invoice.dto';
export class UpdateRentInvoiceDto extends PartialType(CreateRentInvoiceDto) {}
