import { Body, Controller, Get, Headers, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { AgentExcluded } from '../../common/decorators/agent-excluded.decorator';
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
import { QueryMobilePosLiteCounterDeliveryBackfillDto } from './dto/mobile-pos-lite-counter-delivery-backfill.dto';
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

  /**
   * `@AgentExcluded` — activation binds a device secret to a terminal and opens
   * the terminal's custody chain. Till custody and business-day state are
   * invariants the POS reform established by hand; an agent has no way to reason
   * about which physical device is in which cashier's hands, so it must never be
   * the thing that answers that question. Office roles keep the POS *reads*.
   */
  @Post('activate')
  @AgentExcluded()
  @RequirePermissions('mobile_pos_lite.use')
  activate(@Body() dto: ActivateMobilePosTerminalDto, @CurrentUser() user: AuthUser) {
    return this.service.activate(dto, user);
  }

  @Get('session')
  @AgentExcluded('device_headers_not_represented')
  @RequirePermissions('mobile_pos_lite.use')
  session(
    @Headers('x-mobile-pos-terminal') terminalCode: string | undefined,
    @Headers('x-mobile-pos-device') deviceSecret: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.session(terminalCode, deviceSecret, user);
  }

  @Get('products')
  @AgentExcluded('device_headers_not_represented')
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
  @AgentExcluded('device_headers_not_represented')
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
  @AgentExcluded('device_headers_not_represented')
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
  @AgentExcluded('device_headers_not_represented')
  @RequirePermissions('mobile_pos_lite.use')
  customers(
    @Headers('x-mobile-pos-terminal') terminalCode: string | undefined,
    @Headers('x-mobile-pos-device') deviceSecret: string | undefined,
    @Query() query: QueryMobilePosLiteCatalogDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.customers(terminalCode, deviceSecret, query.search, user);
  }

  /**
   * `@AgentExcluded` — ringing up a sale moves business-day state and till
   * custody, and is the one POS write with an irreversible counterpart in the
   * cash drawer. The permission envelope says an office role *may* call this;
   * this says an agent should not, which is a different question. Reads stay
   * available, because "how much did Kaunta take today?" is the question a
   * manager most wants answered.
   */
  @Post('sales')
  @AgentExcluded()
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
  @AgentExcluded('device_headers_not_represented')
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
  @AgentExcluded('device_headers_not_represented')
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
  @AgentExcluded('device_headers_not_represented')
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
  @AgentExcluded('device_headers_not_represented')
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
  @AgentExcluded('device_headers_not_represented')
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
  @AgentExcluded('device_headers_not_represented')
  @RequirePermissions('mobile_pos_lite.use')
  mySalesToday(
    @Headers('x-mobile-pos-terminal') terminalCode: string | undefined,
    @Headers('x-mobile-pos-device') deviceSecret: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.mySalesToday(terminalCode, deviceSecret, user);
  }

  @Get('suppliers')
  @AgentExcluded('device_headers_not_represented')
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
  @AgentExcluded('device_headers_not_represented')
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
  @AgentExcluded('device_headers_not_represented')
  @RequirePermissions('mobile_pos_lite.stock_count')
  createStockCount(
    @Headers('x-mobile-pos-terminal') terminalCode: string | undefined,
    @Headers('x-mobile-pos-device') deviceSecret: string | undefined,
    @Body() dto: CreateMobilePosLiteStockCountDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.createStockCount(terminalCode, deviceSecret, dto, user);
  }

  /**
   * The historical repair (spec-counter-delivery §4): issue the missing
   * collection note for POS counter sales rung before this module recorded one,
   * so they stop reading "Delivered: PENDING" forever.
   *
   * A DESKTOP CALL, NOT A TERMINAL ONE — no terminal headers, deliberately. This
   * is a manager sitting in the office repairing history, not a rep at a
   * counter, and the orders it touches belong to many terminals and many days.
   *
   * GUARDED ON `mobile_pos_lite.manage`, the terminal-admin gate, and NEVER on
   * `.use`: this writes business documents across a company's whole sales
   * history, which is not a thing a phone in a market may ask for. The service
   * asserts the same gate again and scopes the population to what the caller may
   * reach, so the decorator is not the only thing standing between a rep's token
   * and history.
   *
   * There is no request body. Everything about the run is server-derived — the
   * qualifying population, the batch cap, and every field on every note — and
   * the only query parameter narrows the run to one company the caller already
   * has WRITE on. Run it outside trading hours, on staging first; it is capped
   * per request and safe to call repeatedly until it reports no progress.
   */
  @Post('counter-delivery-backfill')
  @RequirePermissions('mobile_pos_lite.manage')
  counterDeliveryBackfill(
    @Query() query: QueryMobilePosLiteCounterDeliveryBackfillDto,
    @Query('companyId') companyId: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.counterDeliveryBackfill({ ...query, companyId }, user);
  }
}
