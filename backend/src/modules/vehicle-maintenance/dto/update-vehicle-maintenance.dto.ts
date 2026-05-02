import { PartialType } from '@nestjs/mapped-types';
import { CreateVehicleMaintenanceDto } from './create-vehicle-maintenance.dto';
export class UpdateVehicleMaintenanceDto extends PartialType(CreateVehicleMaintenanceDto) {}
