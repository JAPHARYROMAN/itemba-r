import { PartialType } from '@nestjs/mapped-types';
import { CreateTaxTransactionDto } from './create-tax-transaction.dto';
export class UpdateTaxTransactionDto extends PartialType(CreateTaxTransactionDto) {}
