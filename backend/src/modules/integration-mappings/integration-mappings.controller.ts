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
import { IntegrationMappingsService } from './integration-mappings.service';
import { CreateIntegrationMappingDto } from './dto/create-integration-mapping.dto';
import { UpdateIntegrationMappingDto } from './dto/update-integration-mapping.dto';
import { QueryIntegrationMappingDto } from './dto/query-integration-mapping.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@Controller('integration-mappings')
export class IntegrationMappingsController {
  constructor(private readonly service: IntegrationMappingsService) {}

  @Get()
  @RequirePermissions('integration_mappings.view')
  findAll(@Query() query: QueryIntegrationMappingDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get(':id')
  @RequirePermissions('integration_mappings.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('integration_mappings.manage')
  create(@Body() dto: CreateIntegrationMappingDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Patch(':id')
  @RequirePermissions('integration_mappings.manage')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateIntegrationMappingDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('integration_mappings.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }
}
