import { PartialType } from '@nestjs/mapped-types';
import { CreateBusinessLicenseDto } from './create-business-license.dto';
export class UpdateBusinessLicenseDto extends PartialType(CreateBusinessLicenseDto) {}
