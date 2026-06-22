import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { SupplierStatementsService } from './supplier-statements.service';
import { GenerateSupplierStatementDto } from './dto/generate-supplier-statement.dto';
import { QuerySupplierStatementDto } from './dto/query-supplier-statement.dto';

@Controller('supplier-statements')
export class SupplierStatementsController {
  constructor(private readonly service: SupplierStatementsService) {}

  @Get()
  @RequirePermissions('supplier_statements.list')
  findAll(@Query() query: QuerySupplierStatementDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get(':id')
  @RequirePermissions('supplier_statements.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post('generate')
  @RequirePermissions('supplier_statements.generate')
  generate(@Body() dto: GenerateSupplierStatementDto, @CurrentUser() user: AuthUser) {
    return this.service.generate(dto, user);
  }
}
