import { PartialType } from '@nestjs/mapped-types';
import { CreateEquipmentUsageDto } from './create-equipment-usage.dto';
export class UpdateEquipmentUsageDto extends PartialType(CreateEquipmentUsageDto) {}
