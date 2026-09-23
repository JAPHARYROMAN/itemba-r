import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Patch,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { memoryStorage } from 'multer';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { AgentExcluded } from '../../common/decorators/agent-excluded.decorator';
import { InvoiceDeskService } from './invoice-desk.service';
import {
  DeskInvoiceDto,
  DeskEditDto,
  DeskPaymentDto,
  DeskQuery,
  DeskReasonDto,
  DeskSupplierDto,
} from './invoice-desk.dto';

/**
 * `@AgentExcluded` — added by the ITEMBA OS redesign (4a155f19) and not yet
 * reviewed for agent eligibility. Every route here stays out of Msaidizi's tool
 * registry (fail closed) until it has reviewed positive evidence.
 */
@Controller('invoice-desk')
@RequirePermissions('invoice_desk.view')
@AgentExcluded()
export class InvoiceDeskController {
  constructor(private readonly service: InvoiceDeskService) {}
  @Get('directory') directory(@CurrentUser() u: AuthUser) {
    return this.service.directory(u);
  }
  @Get('suppliers') suppliers(@CurrentUser() u: AuthUser, @Query() q: DeskQuery) {
    return this.service.suppliers(u, q);
  }
  @Post('suppliers') @RequirePermissions('invoice_desk.view', 'invoice_desk.manage') supplier(
    @CurrentUser() u: AuthUser,
    @Body() d: DeskSupplierDto,
  ) {
    return this.service.createSupplier(u, d);
  }
  @Get('overview') overview(@CurrentUser() u: AuthUser, @Query() q: DeskQuery) {
    return this.service.overview(u, q);
  }
  @Get('invoices') list(@CurrentUser() u: AuthUser, @Query() q: DeskQuery) {
    return this.service.list(u, q);
  }
  @Post('invoices') @RequirePermissions('invoice_desk.view', 'invoice_desk.manage') create(
    @CurrentUser() u: AuthUser,
    @Body() d: DeskInvoiceDto,
  ) {
    return this.service.create(u, d);
  }
  @Get('invoices/:id') detail(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.detail(u, id);
  }
  @Patch('invoices/:id')
  @RequirePermissions('invoice_desk.view', 'invoice_desk.manage')
  edit(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() d: DeskEditDto) {
    return this.service.edit(u, id, d);
  }
  @Post('invoices/:id/payments')
  @RequirePermissions('invoice_desk.view', 'invoice_desk.payments')
  payment(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() d: DeskPaymentDto,
  ) {
    return this.service.payment(u, id, d);
  }
  @Post('invoices/:id/payments/:paymentId/reverse')
  @RequirePermissions('invoice_desk.view', 'invoice_desk.payments')
  reverse(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('paymentId', ParseUUIDPipe) p: string,
    @Body() d: DeskReasonDto,
  ) {
    return this.service.reverse(u, id, p, d);
  }
  @Post('invoices/:id/void') @RequirePermissions('invoice_desk.view', 'invoice_desk.manage') void(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() d: DeskReasonDto,
  ) {
    return this.service.void(u, id, d);
  }
  @Post('invoices/:id/attachments')
  @RequirePermissions('invoice_desk.view', 'invoice_desk.manage')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024, files: 1 },
    }),
  )
  attach(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() f: Express.Multer.File,
  ) {
    return this.service.attach(u, id, f);
  }
  @Get('invoices/:id/attachments/:attachmentId/preview')
  @Header('Cache-Control', 'private, no-store')
  previewAttachment(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('attachmentId', ParseUUIDPipe) a: string,
  ) {
    return this.service.previewAttachment(u, id, a);
  }

  @Get('invoices/:id/attachments/:attachmentId')
  async download(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('attachmentId', ParseUUIDPipe) a: string,
    @Res() res: Response,
    @Query('inline') inline?: string,
  ) {
    const file = await this.service.attachment(u, id, a);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader(
      'Content-Disposition',
      `${(inline === '1' || inline === 'true') && ['application/pdf', 'image/png', 'image/jpeg'].includes(file.mimeType) ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(file.content);
  }
}
