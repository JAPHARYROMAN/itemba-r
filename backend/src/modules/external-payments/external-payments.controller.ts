import { Controller, Get, Post, Body, Param, Query, Request } from '@nestjs/common';
import { ExternalPaymentsService } from './external-payments.service';
import { CreateExternalPaymentDto } from './dto/create-external-payment.dto';
import { QueryExternalPaymentDto } from './dto/query-external-payment.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@Controller('external-payments')
export class ExternalPaymentsController {
  constructor(private readonly service: ExternalPaymentsService) {}

  @Get()
  @RequirePermissions('external_payments.view')
  findAll(
    @Query() query: QueryExternalPaymentDto,
    @Request() req: any,
    @CurrentUser() user: AuthUser,
  ) {
    const hasSensitive = (req.user?.permissions ?? []).includes('external_payments.sensitive.view');
    return this.service.findAll(query, hasSensitive, user);
  }

  @Get(':id')
  @RequirePermissions('external_payments.view')
  findOne(@Param('id') id: string, @Request() req: any) {
    const hasSensitive = (req.user?.permissions ?? []).includes('external_payments.sensitive.view');
    return this.service.findOne(id, hasSensitive);
  }

  @Post()
  @RequirePermissions('external_payments.create')
  create(@Body() dto: CreateExternalPaymentDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.id);
  }

  @Post(':id/confirm')
  @RequirePermissions('external_payments.confirm')
  confirm(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.confirm(id, user.id);
  }

  @Post(':id/reverse')
  @RequirePermissions('external_payments.reverse')
  reverse(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.reverse(id, user.id);
  }
}
