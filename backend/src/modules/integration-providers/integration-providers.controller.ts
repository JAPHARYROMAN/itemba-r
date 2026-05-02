import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { IntegrationProvidersService } from './integration-providers.service';
import { CreateIntegrationProviderDto } from './dto/create-integration-provider.dto';
import { UpdateIntegrationProviderDto } from './dto/update-integration-provider.dto';
import { QueryIntegrationProviderDto } from './dto/query-integration-provider.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@Controller('integration-providers')
export class IntegrationProvidersController {
  constructor(private readonly service: IntegrationProvidersService) {}

  @Get()
  @RequirePermissions('integration_providers.view')
  findAll(@Query() query: QueryIntegrationProviderDto) {
    return this.service.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('integration_providers.view')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions('integration_providers.manage')
  create(@Body() dto: CreateIntegrationProviderDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.id);
  }

  @Patch(':id')
  @RequirePermissions('integration_providers.manage')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateIntegrationProviderDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.update(id, dto, user.id);
  }

  @Delete(':id')
  @RequirePermissions('integration_providers.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.id);
  }
}
