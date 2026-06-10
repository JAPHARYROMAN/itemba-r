import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { FinancialStatementsService } from './financial-statements.service';

@Controller('financial-statements')
export class FinancialStatementsController {
  constructor(private readonly service: FinancialStatementsService) {}

  @Get()
  @RequirePermissions('financial_statements.list')
  findAll(@Query() query: any, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get(':id')
  @RequirePermissions('financial_statements.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post('generate')
  @RequirePermissions('financial_statements.generate')
  generate(@Body() dto: any, @CurrentUser() user: AuthUser) {
    return this.service.generate(dto, user);
  }
}
