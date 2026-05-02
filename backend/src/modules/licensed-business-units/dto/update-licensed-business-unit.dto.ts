import { PartialType } from '@nestjs/mapped-types';
import { CreateLicensedBusinessUnitDto } from './create-licensed-business-unit.dto';
export class UpdateLicensedBusinessUnitDto extends PartialType(CreateLicensedBusinessUnitDto) {}
