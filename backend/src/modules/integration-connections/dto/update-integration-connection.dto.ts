import { PartialType } from '@nestjs/mapped-types';
import { CreateIntegrationConnectionDto } from './create-integration-connection.dto';

export class UpdateIntegrationConnectionDto extends PartialType(CreateIntegrationConnectionDto) {}
