import { PartialType } from '@nestjs/mapped-types';
import { CreateHospitalityFacilityDto } from './create-hospitality-facility.dto';
export class UpdateHospitalityFacilityDto extends PartialType(CreateHospitalityFacilityDto) {}
