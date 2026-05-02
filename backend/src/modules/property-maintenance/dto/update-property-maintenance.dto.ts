import { PartialType } from '@nestjs/mapped-types';
import { CreatePropertyMaintenanceDto } from './create-property-maintenance.dto';
export class UpdatePropertyMaintenanceDto extends PartialType(CreatePropertyMaintenanceDto) {}
