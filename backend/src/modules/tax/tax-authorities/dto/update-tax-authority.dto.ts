import { PartialType } from '@nestjs/mapped-types';
import { CreateTaxAuthorityDto } from './create-tax-authority.dto';
export class UpdateTaxAuthorityDto extends PartialType(CreateTaxAuthorityDto) {}
