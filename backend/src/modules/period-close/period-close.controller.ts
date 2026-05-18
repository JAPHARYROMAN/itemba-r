import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { PeriodCloseService } from './period-close.service';
import { CreatePeriodCloseDto, QueryPeriodCloseDto } from './dto/period-close.dto';

@Controller('period-close')
export class PeriodCloseController {
  constructor(private readonly service: PeriodCloseService) {}

  @Get()
  @RequirePermissions('period_close.list')
  findAll(@Query() query: QueryPeriodCloseDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get(':id')
  @RequirePermissions('period_close.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('period_close.create')
  create(@Body() dto: CreatePeriodCloseDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Post(':id/close')
  @RequirePermissions('period_close.close')
  close(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.close(id, user);
  }

  @Post(':id/reopen')
  @RequirePermissions('period_close.reopen')
  reopen(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.reopen(id, user);
  }
}
