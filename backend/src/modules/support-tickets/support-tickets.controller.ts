import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common';
import { SupportTicketsService } from './support-tickets.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@Controller('support/tickets')
export class SupportTicketsController {
  constructor(private readonly service: SupportTicketsService) {}

  @Post()
  @RequirePermissions('support.tickets.create')
  create(@Body() dto: any, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.id);
  }

  @Get()
  @RequirePermissions('support.tickets.view')
  findAll(@Query() query: any) {
    return this.service.findAll(query);
  }

  @Get('me')
  @RequirePermissions('support.tickets.create')
  findMine(@CurrentUser() user: AuthUser) {
    return this.service.findMine(user.id);
  }

  @Get(':id')
  @RequirePermissions('support.tickets.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Patch(':id')
  @RequirePermissions('support.tickets.manage')
  update(@Param('id') id: string, @Body() dto: any, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user.id);
  }

  @Patch(':id/assign')
  @RequirePermissions('support.tickets.assign')
  assign(@Param('id') id: string, @Body() dto: any, @CurrentUser() user: AuthUser) {
    return this.service.assign(id, dto, user.id);
  }

  @Patch(':id/start')
  @RequirePermissions('support.tickets.manage')
  start(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.setStatus(id, 'IN_PROGRESS', user.id);
  }

  @Patch(':id/resolve')
  @RequirePermissions('support.tickets.resolve')
  resolve(@Param('id') id: string, @Body() dto: any, @CurrentUser() user: AuthUser) {
    return this.service.resolve(id, dto, user.id);
  }

  @Patch(':id/close')
  @RequirePermissions('support.tickets.manage')
  close(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.close(id, user.id);
  }

  @Patch(':id/cancel')
  @RequirePermissions('support.tickets.manage')
  cancel(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.setStatus(id, 'CANCELLED', user.id);
  }

  @Delete(':id')
  @RequirePermissions('support.tickets.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.id);
  }
}
