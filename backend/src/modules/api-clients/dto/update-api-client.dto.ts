import { PartialType } from '@nestjs/mapped-types';
import { CreateApiClientDto } from './create-api-client.dto';

export class UpdateApiClientDto extends PartialType(CreateApiClientDto) {}
