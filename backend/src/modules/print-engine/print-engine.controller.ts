import { Controller, Post, Body, Res } from '@nestjs/common';
import type { Response } from 'express';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { AgentExcluded } from '../../common/decorators/agent-excluded.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { PrintEngineService } from './print-engine.service';
import { RenderDocumentDto, RenderInlineDocumentDto } from './dto/render-document.dto';

@Controller('print-engine')
export class PrintEngineController {
  constructor(private readonly service: PrintEngineService) {}

  @Post('render')
  @RequirePermissions('print_engine.render')
  render(@Body() dto: RenderInlineDocumentDto, @CurrentUser() user: AuthUser) {
    return this.service.render(dto, user);
  }

  @Post('render-pdf')
  @AgentExcluded('binary_result_not_represented')
  @RequirePermissions('print_engine.render')
  async renderPdf(
    @Body() dto: RenderDocumentDto,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ) {
    const result = await this.service.renderPdf(dto, user);
    res.setHeader('Content-Type', result.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.setHeader('X-Generated-Document-Id', result.id);
    res.send(result.buffer);
  }

  @Post('render-excel')
  @AgentExcluded('binary_result_not_represented')
  @RequirePermissions('print_engine.render')
  async renderExcel(
    @Body() dto: RenderDocumentDto,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ) {
    const result = await this.service.renderExcel(dto, user);
    res.setHeader('Content-Type', result.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.setHeader('X-Generated-Document-Id', result.id);
    res.send(result.buffer);
  }
}
