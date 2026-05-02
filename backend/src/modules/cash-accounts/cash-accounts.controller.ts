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
import { CashAccountsService } from './cash-accounts.service';
import { CreateCashAccountDto } from './dto/create-cash-account.dto';
import { UpdateCashAccountDto } from './dto/update-cash-account.dto';
import { QueryCashAccountDto } from './dto/query-cash-account.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@Controller('cash-accounts')
export class CashAccountsController {
  constructor(private readonly service: CashAccountsService) {}

  @Get()
  @RequirePermissions('cash_accounts.view')
  findAll(@Query() query: QueryCashAccountDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get('company/:companyId')
  @RequirePermissions('cash_accounts.view')
  findByCompany(@Param('companyId') companyId: string, @CurrentUser() user: AuthUser) {
    return this.service.findByCompany(companyId, user);
  }

  @Get(':id')
  @RequirePermissions('cash_accounts.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('cash_accounts.manage')
  create(@Body() dto: CreateCashAccountDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Patch(':id')
  @RequirePermissions('cash_accounts.manage')
  update(@Param('id') id: string, @Body() dto: UpdateCashAccountDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('cash_accounts.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }
}
