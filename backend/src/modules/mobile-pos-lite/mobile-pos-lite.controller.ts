import { Body, Controller, Get, Headers, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import {
  CreateMobilePosTerminalDto,
  QueryMobilePosTerminalDto,
  UpdateMobilePosTerminalDto,
  UpdateMobilePosTerminalStatusDto,
} from './dto/mobile-pos-terminal.dto';
import {
  ActivateMobilePosTerminalDto,
  QueryMobilePosLiteCatalogDto,
} from './dto/mobile-pos-lite-session.dto';
import { CreateMobilePosLiteSaleDto } from './dto/mobile-pos-lite-sale.dto';
import { CreateMobilePosLitePurchaseDto } from './dto/mobile-pos-lite-purchase.dto';
import { CreateMobilePosLiteStockCountDto } from './dto/mobile-pos-lite-stock-count.dto';
import { QueryMobilePosLiteStockDto } from './dto/mobile-pos-lite-stock.dto';
import {
  CreateMobilePosLiteDayReportDto,
  QueryMobilePosLiteDayReportsDto,
} from './dto/mobile-pos-lite-day-report.dto';
import { MobilePosLiteService } from './mobile-pos-lite.service';

@Controller('mobile-pos-lite')
export class MobilePosLiteController {
  constructor(private readonly service: MobilePosLiteService) {}

  @Get('terminals')
  @RequirePermissions('mobile_pos_lite.manage')
  findTerminals(@Query() query: QueryMobilePosTerminalDto, @CurrentUser() user: AuthUser) {
    return this.service.findTerminals(query, user);
  }

  @Post('terminals')
  @RequirePermissions('mobile_pos_lite.manage')
  createTerminal(@Body() dto: CreateMobilePosTerminalDto, @CurrentUser() user: AuthUser) {
    return this.service.createTerminal(dto, user);
  }

  @Patch('terminals/:id')
  @RequirePermissions('mobile_pos_lite.manage')
  updateTerminal(
    @Param('id') id: string,
    @Body() dto: UpdateMobilePosTerminalDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.updateTerminal(id, dto, user);
  }

  @Patch('terminals/:id/status')
  @RequirePermissions('mobile_pos_lite.manage')
  updateTerminalStatus(
    @Param('id') id: string,
    @Body() dto: UpdateMobilePosTerminalStatusDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.updateTerminalStatus(id, dto.status, user);
  }

  @Post('terminals/:id/activation')
  @RequirePermissions('mobile_pos_lite.manage')
  issueActivation(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.issueActivation(id, user);
  }

  @Post('activate')
  @RequirePermissions('mobile_pos_lite.use')
  activate(@Body() dto: ActivateMobilePosTerminalDto, @CurrentUser() user: AuthUser) {
    return this.service.activate(dto, user);
  }

  @Get('session')
  @RequirePermissions('mobile_pos_lite.use')
  session(
    @Headers('x-mobile-pos-terminal') terminalCode: string | undefined,
    @Headers('x-mobile-pos-device') deviceSecret: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.session(terminalCode, deviceSecret, user);
  }

  @Get('products')
  @RequirePermissions('mobile_pos_lite.use')
  products(
    @Headers('x-mobile-pos-terminal') terminalCode: string | undefined,
    @Headers('x-mobile-pos-device') deviceSecret: string | undefined,
    @Query() query: QueryMobilePosLiteCatalogDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.products(terminalCode, deviceSecret, query.search, user);
  }

  @Get('catalog')
  @RequirePermissions('mobile_pos_lite.use')
  catalog(
    @Headers('x-mobile-pos-terminal') terminalCode: string | undefined,
    @Headers('x-mobile-pos-device') deviceSecret: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.products(terminalCode, deviceSecret, undefined, user);
  }

  /**
   * Branch stock for the Stoo screen (spec-inventory §1.1). The terminal
   * headers pin the branch server-side — the client can never choose one.
   * REVIEW-BLOCKING RULE: this route must never return cost or value fields
   * (averageCost/totalValue/unitCost/riskValue); see the service method.
   */
  @Get('stock')
  @RequirePermissions('mobile_pos_lite.use')
  stock(
    @Headers('x-mobile-pos-terminal') terminalCode: string | undefined,
    @Headers('x-mobile-pos-device') deviceSecret: string | undefined,
    @Query() query: QueryMobilePosLiteStockDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.stock(terminalCode, deviceSecret, query.search, user);
  }

  @Get('customers')
  @RequirePermissions('mobile_pos_lite.use')
  customers(
    @Headers('x-mobile-pos-terminal') terminalCode: string | undefined,
    @Headers('x-mobile-pos-device') deviceSecret: string | undefined,
    @Query() query: QueryMobilePosLiteCatalogDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.customers(terminalCode, deviceSecret, query.search, user);
  }

  @Post('sales')
  @RequirePermissions('mobile_pos_lite.use')
  createSale(
    @Headers('x-mobile-pos-terminal') terminalCode: string | undefined,
    @Headers('x-mobile-pos-device') deviceSecret: string | undefined,
    @Body() dto: CreateMobilePosLiteSaleDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.createSale(terminalCode, deviceSecret, dto, user);
  }

  /**
   * Letterhead receipt PDF for a sale recorded on this terminal.
   * Non-passthrough @Res() so the PDF bytes bypass the TransformInterceptor's
   * { data } envelope, same as generated-documents table-pdf.
   */
  @Get('sales/:id/receipt')
  @RequirePermissions('mobile_pos_lite.use')
  async saleReceipt(
    @Headers('x-mobile-pos-terminal') terminalCode: string | undefined,
    @Headers('x-mobile-pos-device') deviceSecret: string | undefined,
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ) {
    const receipt = await this.service.saleReceipt(terminalCode, deviceSecret, id, user);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${receipt.fileName}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(receipt.buffer);
  }

  /**
   * This rep's own sales over the history window (spec-history-reports §1.1),
   * for Historia ya Mauzo. Same path as the POST above; the verbs disambiguate.
   * There is deliberately no `days` parameter — the window is a server
   * constant.
   * REVIEW-BLOCKING RULE: selling prices are allowed here (they are already on
   * the phone in the catalog and on every printed receipt); cost and margin
   * NEVER are. See the service method.
   */
  @Get('sales')
  @RequirePermissions('mobile_pos_lite.use')
  salesHistory(
    @Headers('x-mobile-pos-terminal') terminalCode: string | undefined,
    @Headers('x-mobile-pos-device') deviceSecret: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.salesHistory(terminalCode, deviceSecret, user);
  }

  /**
   * What this branch received through the POS over the history window
   * (spec-history-reports §1.2), for Historia ya Manunuzi. Gated on
   * mobile_pos_lite.purchase — the same manager gate that guards recording a
   * delivery — never on .use.
   * REVIEW-BLOCKING RULE — THE COST-BLINDNESS LAW: this route must NEVER return
   * a cost, total or value field of any kind (unitCost, lineTotal, totalAmount,
   * subtotal, paidAmount, averageCost, margin, or anything derived from them),
   * and it carries no window total. A stolen phone must reveal nothing about
   * what this business pays its suppliers. See the service method.
   */
  @Get('purchases')
  @RequirePermissions('mobile_pos_lite.purchase')
  purchaseHistory(
    @Headers('x-mobile-pos-terminal') terminalCode: string | undefined,
    @Headers('x-mobile-pos-device') deviceSecret: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.purchaseHistory(terminalCode, deviceSecret, user);
  }

  /**
   * The end-of-day close (spec-history-reports §1.3). The body carries only an
   * idempotency key, the day being closed and the phone's declared held
   * figures; every number the office reads is recomputed server-side.
   */
  @Post('day-reports')
  @RequirePermissions('mobile_pos_lite.use')
  createDayReport(
    @Headers('x-mobile-pos-terminal') terminalCode: string | undefined,
    @Headers('x-mobile-pos-device') deviceSecret: string | undefined,
    @Body() dto: CreateMobilePosLiteDayReportDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.createDayReport(terminalCode, deviceSecret, dto, user);
  }

  /**
   * The office's read surface for submitted day reports
   * (spec-history-reports §1.5). A desktop call: no terminal headers, the
   * existing terminal-admin gate, and company scope from the AuthUser.
   */
  @Get('day-reports')
  @RequirePermissions('mobile_pos_lite.manage')
  dayReports(@Query() query: QueryMobilePosLiteDayReportsDto, @CurrentUser() user: AuthUser) {
    return this.service.dayReports(query, user);
  }

  /**
   * Letterhead day-report PDF for a report submitted from this terminal.
   * Non-passthrough @Res() so the PDF bytes bypass the TransformInterceptor's
   * { data } envelope, byte-for-byte the shape of sales/:id/receipt above.
   */
  @Get('day-reports/:id/pdf')
  @RequirePermissions('mobile_pos_lite.use')
  async dayReportPdf(
    @Headers('x-mobile-pos-terminal') terminalCode: string | undefined,
    @Headers('x-mobile-pos-device') deviceSecret: string | undefined,
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ) {
    const report = await this.service.dayReportPdf(terminalCode, deviceSecret, id, user);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${report.fileName}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(report.buffer);
  }

  @Get('my-sales-today')
  @RequirePermissions('mobile_pos_lite.use')
  mySalesToday(
    @Headers('x-mobile-pos-terminal') terminalCode: string | undefined,
    @Headers('x-mobile-pos-device') deviceSecret: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.mySalesToday(terminalCode, deviceSecret, user);
  }

  @Get('suppliers')
  @RequirePermissions('mobile_pos_lite.purchase')
  suppliers(
    @Headers('x-mobile-pos-terminal') terminalCode: string | undefined,
    @Headers('x-mobile-pos-device') deviceSecret: string | undefined,
    @Query() query: QueryMobilePosLiteCatalogDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.suppliers(terminalCode, deviceSecret, query.search, user);
  }

  @Post('purchases')
  @RequirePermissions('mobile_pos_lite.purchase')
  createPurchase(
    @Headers('x-mobile-pos-terminal') terminalCode: string | undefined,
    @Headers('x-mobile-pos-device') deviceSecret: string | undefined,
    @Body() dto: CreateMobilePosLitePurchaseDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.createPurchase(terminalCode, deviceSecret, dto, user);
  }

  /**
   * Physical stock count from the shelf (spec-inventory §1.2). The core
   * stock-adjustment services enforce company-scope WRITE only, so THIS
   * decorator is the sole permission gate on the count chain; the terminal
   * headers pin the branch the count is read and posted against.
   * REVIEW-BLOCKING RULE: no cost or value field may enter or leave this route.
   */
  @Post('stock-counts')
  @RequirePermissions('mobile_pos_lite.stock_count')
  createStockCount(
    @Headers('x-mobile-pos-terminal') terminalCode: string | undefined,
    @Headers('x-mobile-pos-device') deviceSecret: string | undefined,
    @Body() dto: CreateMobilePosLiteStockCountDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.createStockCount(terminalCode, deviceSecret, dto, user);
  }
}
