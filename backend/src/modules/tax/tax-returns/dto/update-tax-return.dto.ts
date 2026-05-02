import { PartialType } from '@nestjs/mapped-types';
import { CreateTaxReturnDto } from './create-tax-return.dto';
export class UpdateTaxReturnDto extends PartialType(CreateTaxReturnDto) {}
