import { PartialType } from '@nestjs/mapped-types';
import { CreateFuelTankDto } from './create-fuel-tank.dto';

export class UpdateFuelTankDto extends PartialType(CreateFuelTankDto) {}
