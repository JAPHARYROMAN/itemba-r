import { PartialType, OmitType } from '@nestjs/swagger';
import { CreateProformaInvoiceDto } from './create-proforma-invoice.dto';

export class UpdateProformaInvoiceDto extends PartialType(OmitType(CreateProformaInvoiceDto, ['companyId'] as const)) {}
