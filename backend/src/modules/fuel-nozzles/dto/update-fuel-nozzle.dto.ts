import { PartialType } from '@nestjs/mapped-types';
import { CreateFuelNozzleDto } from './create-fuel-nozzle.dto';

export class UpdateFuelNozzleDto extends PartialType(CreateFuelNozzleDto) {}
