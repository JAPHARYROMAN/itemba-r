import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { RefundsService } from './refunds.service';
import { CreateRefundDto } from './dto/create-refund.dto';
import { QueryRefundDto } from './dto/query-refund.dto';
import { PayRefundDto } from './dto/pay-refund.dto';
import { VoidRefundDto } from './dto/void-refund.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@Controller('refunds')
export class RefundsController {
  constructor(private readonly service: RefundsService) {}

  @Get()
  @RequirePermissions('refunds.view')
  findAll(@Query() query: QueryRefundDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get(':id')
  @RequirePermissions('refunds.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('refunds.manage')
  create(@Body() dto: CreateRefundDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Patch(':id/pay')
  @RequirePermissions('refunds.manage')
  pay(@Param('id') id: string, @Body() dto: PayRefundDto, @CurrentUser() user: AuthUser) {
    return this.service.pay(id, dto, user);
  }

  @Patch(':id/void')
  @RequirePermissions('refunds.manage')
  void(@Param('id') id: string, @Body() dto: VoidRefundDto, @CurrentUser() user: AuthUser) {
    return this.service.void(id, dto, user);
  }
}
