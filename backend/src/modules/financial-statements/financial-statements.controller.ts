import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { CompanyPageLimitQueryDto } from '../../common/dto/resource-query.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { FinancialStatementsService } from './financial-statements.service';
import { GenerateFinancialStatementDto } from './dto/generate-financial-statement.dto';

@Controller('financial-statements')
export class FinancialStatementsController {
  constructor(private readonly service: FinancialStatementsService) {}

  @Get()
  @RequirePermissions('financial_statements.list')
  findAll(@Query() query: CompanyPageLimitQueryDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get(':id')
  @RequirePermissions('financial_statements.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post('generate')
  @RequirePermissions('financial_statements.generate')
  generate(@Body() dto: GenerateFinancialStatementDto, @CurrentUser() user: AuthUser) {
    return this.service.generate(dto, user);
  }
}
