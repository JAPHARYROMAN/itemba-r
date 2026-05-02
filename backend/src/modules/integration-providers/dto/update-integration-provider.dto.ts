import { PartialType } from '@nestjs/mapped-types';
import { CreateIntegrationProviderDto } from './create-integration-provider.dto';

export class UpdateIntegrationProviderDto extends PartialType(CreateIntegrationProviderDto) {}
