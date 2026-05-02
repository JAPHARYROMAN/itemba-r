import { PartialType } from '@nestjs/mapped-types';
import { CreateFarmInputApplicationDto } from './create-farm-input-application.dto';
export class UpdateFarmInputApplicationDto extends PartialType(CreateFarmInputApplicationDto) {}
