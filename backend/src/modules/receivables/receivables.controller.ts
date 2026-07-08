import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common';
import { ReceivablesService } from './receivables.service';
import { CreateReceivableDto } from './dto/create-receivable.dto';
import { UpdateReceivableDto } from './dto/update-receivable.dto';
import { QueryReceivableDto } from './dto/query-receivable.dto';
import { RecordReceivablePaymentDto } from './dto/record-receivable-payment.dto';
import { WriteOffReceivableDto } from './dto/write-off-receivable.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@Controller('receivables')
export class ReceivablesController {
  constructor(private readonly service: ReceivablesService) {}

  @Get()
  @RequirePermissions('receivables.view')
  findAll(@Query() query: QueryReceivableDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get('accounts')
  @RequirePermissions('receivables.view')
  findAccounts(@Query() query: QueryReceivableDto, @CurrentUser() user: AuthUser) {
    return this.service.findAccounts(query, user);
  }

  @Get(':id')
  @RequirePermissions('receivables.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('receivables.manage')
  create(@Body() dto: CreateReceivableDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Patch(':id')
  @RequirePermissions('receivables.manage')
  update(@Param('id') id: string, @Body() dto: UpdateReceivableDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user);
  }

  @Patch(':id/record-payment')
  @RequirePermissions('receivables.manage')
  recordPayment(
    @Param('id') id: string,
    @Body() dto: RecordReceivablePaymentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.recordPayment(id, dto, user);
  }

  @Patch(':id/write-off')
  @RequirePermissions('receivables.manage')
  writeOff(
    @Param('id') id: string,
    @Body() dto: WriteOffReceivableDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.writeOff(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('receivables.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }
}
