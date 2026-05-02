import { PartialType } from '@nestjs/mapped-types';
import { CreateFuelTankDipDto } from './create-fuel-tank-dip.dto';

export class UpdateFuelTankDipDto extends PartialType(CreateFuelTankDipDto) {}
