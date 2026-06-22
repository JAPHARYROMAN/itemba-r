import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { CustomerStatementsService } from './customer-statements.service';
import { GenerateCustomerStatementDto } from './dto/generate-customer-statement.dto';
import { QueryCustomerStatementDto } from './dto/query-customer-statement.dto';

@Controller('customer-statements')
export class CustomerStatementsController {
  constructor(private readonly service: CustomerStatementsService) {}

  @Get()
  @RequirePermissions('customer_statements.list')
  findAll(@Query() query: QueryCustomerStatementDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get(':id')
  @RequirePermissions('customer_statements.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post('generate')
  @RequirePermissions('customer_statements.generate')
  generate(@Body() dto: GenerateCustomerStatementDto, @CurrentUser() user: AuthUser) {
    return this.service.generate(dto, user);
  }
}
