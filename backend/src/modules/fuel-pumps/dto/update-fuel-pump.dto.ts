import { PartialType } from '@nestjs/mapped-types';
import { CreateFuelPumpDto } from './create-fuel-pump.dto';

export class UpdateFuelPumpDto extends PartialType(CreateFuelPumpDto) {}
