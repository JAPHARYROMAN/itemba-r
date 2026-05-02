import { PartialType } from '@nestjs/mapped-types';
import { CreateIntercompanyTransactionDto } from './create-intercompany-transaction.dto';

export class UpdateIntercompanyTransactionDto extends PartialType(CreateIntercompanyTransactionDto) {}
