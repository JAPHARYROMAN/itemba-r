import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  Header,
} from '@nestjs/common';
import { Response } from 'express';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { AgentExcluded } from '../../common/decorators/agent-excluded.decorator';
import {
  CreateRecordDto,
  RecordReasonDto,
  RecordSettlementDto,
  RecordStatementQuery,
  RecordsQuery,
  UpdateRecordDto,
} from './records.dto';
import { RecordsService } from './records.service';

@Controller('records')
@RequirePermissions('records.view')
@AgentExcluded()
export class RecordsController {
  constructor(private readonly service: RecordsService) {}
  @Get('directory') directory(@CurrentUser() u: AuthUser) {
    return this.service.directory(u);
  }
  @Get('summary') summary(@CurrentUser() u: AuthUser, @Query() q: RecordsQuery) {
    return this.service.summary(u, q);
  }
  @Get('export')
  @RequirePermissions('records.view', 'records.export')
  export(@CurrentUser() u: AuthUser, @Query() q: RecordsQuery) {
    return this.service.export(u, q);
  }
  @Get() list(@CurrentUser() u: AuthUser, @Query() q: RecordsQuery) {
    return this.service.list(u, q);
  }
  @Get(':id') detail(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.detail(u, id);
  }
  @Get(':id/statement')
  @Header('Cache-Control', 'no-store')
  statement(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: RecordStatementQuery,
  ) {
    return this.service.statement(u, id, q);
  }
  @Get(':id/statement/export')
  @RequirePermissions('records.view', 'records.export')
  async exportStatement(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: RecordStatementQuery,
    @Res() res: Response,
  ) {
    const result = await this.service.exportStatement(u, id, q);
    res.set({
      'Content-Type': result.mimeType,
      'Content-Disposition': `attachment; filename="${result.filename}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.send(result.buffer);
  }
  @Post()
  @RequirePermissions('records.view', 'records.manage')
  create(@CurrentUser() u: AuthUser, @Body() d: CreateRecordDto) {
    return this.service.create(u, d);
  }
  @Patch(':id')
  @RequirePermissions('records.view', 'records.manage')
  update(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() d: UpdateRecordDto,
  ) {
    return this.service.update(u, id, d);
  }
  @Post(':id/settlements')
  @RequirePermissions('records.view', 'records.manage')
  settle(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() d: RecordSettlementDto,
  ) {
    return this.service.settle(u, id, d);
  }
  @Post(':id/settlements/:settlementId/reverse')
  @RequirePermissions('records.view', 'records.manage')
  reverse(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('settlementId', ParseUUIDPipe) settlementId: string,
    @Body() d: RecordReasonDto,
  ) {
    return this.service.reverse(u, id, settlementId, d);
  }
  @Post(':id/void')
  @RequirePermissions('records.view', 'records.manage')
  void(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() d: RecordReasonDto,
  ) {
    return this.service.void(u, id, d);
  }
}
