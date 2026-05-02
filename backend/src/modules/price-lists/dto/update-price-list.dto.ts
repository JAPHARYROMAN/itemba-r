import { PartialType, OmitType } from '@nestjs/swagger';
import { CreatePriceListDto } from './create-price-list.dto';

export class UpdatePriceListDto extends PartialType(OmitType(CreatePriceListDto, ['companyId'] as const)) {}
