import { PartialType } from '@nestjs/mapped-types';
import { CreateFuelPriceDto } from './create-fuel-price.dto';

export class UpdateFuelPriceDto extends PartialType(CreateFuelPriceDto) {}
