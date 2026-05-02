import { PartialType, OmitType } from '@nestjs/swagger';
import { CreateQuotationDto } from './create-quotation.dto';

export class UpdateQuotationDto extends PartialType(OmitType(CreateQuotationDto, ['companyId'] as const)) {}
