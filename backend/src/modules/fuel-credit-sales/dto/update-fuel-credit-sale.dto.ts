import { PartialType } from '@nestjs/mapped-types';
import { CreateFuelCreditSaleDto } from './create-fuel-credit-sale.dto';

export class UpdateFuelCreditSaleDto extends PartialType(CreateFuelCreditSaleDto) {}
