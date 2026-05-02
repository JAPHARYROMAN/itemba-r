import { PartialType } from '@nestjs/swagger';
import { CreateSalesChannelDto } from './create-sales-channel.dto';

export class UpdateSalesChannelDto extends PartialType(CreateSalesChannelDto) {}
