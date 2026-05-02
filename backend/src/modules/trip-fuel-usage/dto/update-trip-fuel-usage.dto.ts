import { PartialType } from '@nestjs/mapped-types';
import { CreateTripFuelUsageDto } from './create-trip-fuel-usage.dto';
export class UpdateTripFuelUsageDto extends PartialType(CreateTripFuelUsageDto) {}
