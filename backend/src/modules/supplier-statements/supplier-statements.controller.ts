import { Controller, Get, Post, Body, Param, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { AgentExcluded } from '../../common/decorators/agent-excluded.decorator';
import { ExportSupplierStatementDto } from './dto/export-supplier-statement.dto';
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

  @Get(':id/export')
  // Party linkage (Phase 3): agent-excluded until its Msaidizi evidence fixture is authored.
  @AgentExcluded()
  @RequirePermissions('supplier_statements.view')
  async export(
    @Param('id') id: string,
    @Query() q: ExportSupplierStatementDto,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ) {
    const result = await this.service.export(id, q.format ?? 'pdf', user);
    res.set({
      'Content-Type': result.mimeType,
      'Content-Disposition': `attachment; filename="${result.filename}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.send(result.buffer);
  }

  @Post('generate')
  @RequirePermissions('supplier_statements.generate')
  generate(@Body() dto: GenerateSupplierStatementDto, @CurrentUser() user: AuthUser) {
    return this.service.generate(dto, user);
  }
}
