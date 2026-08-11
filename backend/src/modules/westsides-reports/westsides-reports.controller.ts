import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { WestsidesReportsService } from './westsides-reports.service';
import { QueryReportDto } from './dto/query-report.dto';
import { SaveDailyCloseDto } from './dto/save-daily-close.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@ApiTags('westsides/reports')
@Controller('westsides/reports')
export class WestsidesReportsController {
  constructor(private readonly service: WestsidesReportsService) {}

  @Get('sales-report')
  @RequirePermissions('westsides.reports.view')
  @ApiOperation({ summary: 'Readable sales report with products, customers, units, and amounts' })
  salesReport(@Query() query: QueryReportDto, @CurrentUser() user: AuthUser) {
    return this.service.salesReport(query, user);
  }

  @Get('sales-by-customer')
  @RequirePermissions('westsides.reports.view')
  @ApiOperation({ summary: 'Sales grouped by customer' })
  salesByCustomer(@Query() query: QueryReportDto, @CurrentUser() user: AuthUser) {
    return this.service.salesByCustomer(query, user);
  }

  @Get('customer-product-sales')
  @RequirePermissions('westsides.reports.view')
  @ApiOperation({ summary: 'Customer purchases grouped by customer and product' })
  customerProductSales(@Query() query: QueryReportDto, @CurrentUser() user: AuthUser) {
    return this.service.customerProductSales(query, user);
  }

  @Get('purchase-report')
  @RequirePermissions('westsides.reports.view')
  @ApiOperation({
    summary: 'Readable purchase report with suppliers, products, units, and amounts',
  })
  purchaseReport(@Query() query: QueryReportDto, @CurrentUser() user: AuthUser) {
    return this.service.purchaseReport(query, user);
  }

  @Get('purchases-by-supplier')
  @RequirePermissions('westsides.reports.view')
  @ApiOperation({ summary: 'Purchases grouped by supplier' })
  purchasesBySupplier(@Query() query: QueryReportDto, @CurrentUser() user: AuthUser) {
    return this.service.purchasesBySupplier(query, user);
  }

  @Get('supplier-product-purchases')
  @RequirePermissions('westsides.reports.view')
  @ApiOperation({ summary: 'Supplier purchases grouped by supplier and product' })
  supplierProductPurchases(@Query() query: QueryReportDto, @CurrentUser() user: AuthUser) {
    return this.service.supplierProductPurchases(query, user);
  }

  @Get('customers-report')
  @RequirePermissions('westsides.reports.view')
  @ApiOperation({ summary: 'Readable customer report with balances and sales totals' })
  customersReport(@Query() query: QueryReportDto, @CurrentUser() user: AuthUser) {
    return this.service.customersReport(query, user);
  }

  @Get('suppliers-report')
  @RequirePermissions('westsides.reports.view')
  @ApiOperation({ summary: 'Readable supplier report with balances and purchase totals' })
  suppliersReport(@Query() query: QueryReportDto, @CurrentUser() user: AuthUser) {
    return this.service.suppliersReport(query, user);
  }

  @Get('sales-by-channel')
  @RequirePermissions('westsides.reports.view')
  @ApiOperation({ summary: 'Sales grouped by channel' })
  salesByChannel(@Query() query: QueryReportDto, @CurrentUser() user: AuthUser) {
    return this.service.salesByChannel(query, user);
  }

  @Get('sales-by-product')
  @RequirePermissions('westsides.reports.view')
  @ApiOperation({ summary: 'Sales grouped by product' })
  salesByProduct(@Query() query: QueryReportDto, @CurrentUser() user: AuthUser) {
    return this.service.salesByProduct(query, user);
  }

  @Get('sales-by-cashier')
  @RequirePermissions('westsides.reports.view')
  @ApiOperation({ summary: 'Sales grouped by cashier' })
  salesByCashier(@Query() query: QueryReportDto, @CurrentUser() user: AuthUser) {
    return this.service.salesByCashier(query, user);
  }

  @Get('batch-status')
  @RequirePermissions('westsides.reports.view')
  @ApiOperation({ summary: 'Batch status report' })
  batchStatus(@Query() query: QueryReportDto, @CurrentUser() user: AuthUser) {
    return this.service.batchStatus(query, user);
  }

  @Get('stock-damage-report')
  @RequirePermissions('westsides.reports.view')
  @ApiOperation({ summary: 'Stock damage report by type' })
  stockDamageReport(@Query() query: QueryReportDto, @CurrentUser() user: AuthUser) {
    return this.service.stockDamageReport(query, user);
  }

  @Get('package-balance-report')
  @RequirePermissions('westsides.reports.view')
  @ApiOperation({ summary: 'Customer package balances' })
  packageBalanceReport(@Query() query: QueryReportDto, @CurrentUser() user: AuthUser) {
    return this.service.packageBalanceReport(query, user);
  }

  @Get('quotation-conversion')
  @RequirePermissions('westsides.reports.view')
  @ApiOperation({ summary: 'Quotation conversion rates' })
  quotationConversion(@Query() query: QueryReportDto, @CurrentUser() user: AuthUser) {
    return this.service.quotationConversion(query, user);
  }

  @Get('delivery-performance')
  @RequirePermissions('westsides.reports.view')
  @ApiOperation({ summary: 'Delivery note performance by status' })
  deliveryPerformance(@Query() query: QueryReportDto, @CurrentUser() user: AuthUser) {
    return this.service.deliveryPerformance(query, user);
  }

  @Get('price-list-report')
  @RequirePermissions('westsides.reports.view')
  @ApiOperation({ summary: 'Price lists with item counts' })
  priceListReport(@Query() query: QueryReportDto, @CurrentUser() user: AuthUser) {
    return this.service.priceListReport(query, user);
  }

  @Get('fast-moving-items')
  @RequirePermissions('westsides.reports.view')
  @ApiOperation({ summary: 'Top 20 fast-moving items' })
  fastMovingItems(@Query() query: QueryReportDto, @CurrentUser() user: AuthUser) {
    return this.service.fastMovingItems(query, user);
  }

  @Get('slow-moving-items')
  @RequirePermissions('westsides.reports.view')
  @ApiOperation({ summary: 'Slow-moving items (no sales in 30 days)' })
  slowMovingItems(@Query() query: QueryReportDto, @CurrentUser() user: AuthUser) {
    return this.service.slowMovingItems(query, user);
  }

  @Get('product-profitability')
  @RequirePermissions('westsides.reports.view')
  @ApiOperation({ summary: 'Product revenue vs cost' })
  productProfitability(@Query() query: QueryReportDto, @CurrentUser() user: AuthUser) {
    return this.service.productProfitability(query, user);
  }

  @Get('credit-customers-report')
  @RequirePermissions('westsides.reports.view')
  @ApiOperation({ summary: 'Customers with receivable balances' })
  creditCustomersReport(@Query() query: QueryReportDto, @CurrentUser() user: AuthUser) {
    return this.service.creditCustomersReport(query, user);
  }

  @Get('daily-sales-summary')
  @RequirePermissions('westsides.reports.view')
  @ApiOperation({ summary: 'Daily sales aggregation' })
  dailySalesSummary(@Query() query: QueryReportDto, @CurrentUser() user: AuthUser) {
    return this.service.dailySalesSummary(query, user);
  }

  @Get('monthly-sales-summary')
  @RequirePermissions('westsides.reports.view')
  @ApiOperation({ summary: 'Monthly sales aggregation' })
  monthlySalesSummary(@Query() query: QueryReportDto, @CurrentUser() user: AuthUser) {
    return this.service.monthlySalesSummary(query, user);
  }

  @Get('daily-close')
  @RequirePermissions('westsides.reports.view')
  @ApiOperation({ summary: 'Daily Close / Z-Report — single-day reconciliation aggregate' })
  dailyClose(
    @Query('companyId') companyId: string,
    @Query('branchId') branchId: string | undefined,
    @CurrentUser() user: AuthUser,
    @Query('date') date: string | undefined,
  ) {
    return this.service.dailyClose({ companyId, branchId, date }, user);
  }

  @Post('daily-close')
  @RequirePermissions('westsides.daily_close.manage')
  @ApiOperation({ summary: 'Persist the daily cash close: counted amounts, variance, and sign-off' })
  saveDailyClose(@Body() dto: SaveDailyCloseDto, @CurrentUser() user: AuthUser) {
    return this.service.saveDailyClose(dto, user);
  }
}
