import { PartialType } from '@nestjs/mapped-types';
import { CreateCompanyTaxRegistrationDto } from './create-company-tax-registration.dto';
export class UpdateCompanyTaxRegistrationDto extends PartialType(CreateCompanyTaxRegistrationDto) {}
