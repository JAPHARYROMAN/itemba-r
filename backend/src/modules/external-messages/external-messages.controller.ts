import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { ExternalMessagesService } from './external-messages.service';
import { CreateExternalMessageDto } from './dto/create-external-message.dto';
import { QueryExternalMessageDto } from './dto/query-external-message.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@Controller('external-messages')
export class ExternalMessagesController {
  constructor(private readonly service: ExternalMessagesService) {}

  @Get()
  @RequirePermissions('external_messages.view')
  findAll(@Query() query: QueryExternalMessageDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get(':id')
  @RequirePermissions('external_messages.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('external_messages.send')
  create(@Body() dto: CreateExternalMessageDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.id);
  }
}
