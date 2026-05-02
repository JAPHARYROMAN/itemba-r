import { PartialType } from '@nestjs/mapped-types';
import { CreateEmploymentContractDto } from './create-employment-contract.dto';
export class UpdateEmploymentContractDto extends PartialType(CreateEmploymentContractDto) {}
