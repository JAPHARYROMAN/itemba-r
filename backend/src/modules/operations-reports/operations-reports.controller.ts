import { Controller, Get, Query } from '@nestjs/common';
import { OperationsReportsService } from './operations-reports.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { IsOptional, IsString, IsNumberString } from 'class-validator';

class StockValuationQueryDto {
  @IsOptional() @IsString() companyId?: string;
  @IsOptional() @IsString() divisionId?: string;
  @IsOptional() @IsString() locationId?: string;
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsString() productId?: string;
}

class SalesSummaryQueryDto {
  @IsOptional() @IsString() companyId?: string;
  @IsOptional() @IsString() divisionId?: string;
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsString() locationId?: string;
  @IsOptional() @IsString() customerId?: string;
  @IsOptional() @IsString() productId?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() paymentStatus?: string;
  @IsOptional() @IsString() dateFrom?: string;
  @IsOptional() @IsString() dateTo?: string;
  @IsOptional() @IsNumberString() pageSize?: string;
}

class PurchaseSummaryQueryDto {
  @IsOptional() @IsString() companyId?: string;
  @IsOptional() @IsString() divisionId?: string;
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsString() locationId?: string;
  @IsOptional() @IsString() supplierId?: string;
  @IsOptional() @IsString() productId?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() paymentStatus?: string;
  @IsOptional() @IsString() dateFrom?: string;
  @IsOptional() @IsString() dateTo?: string;
  @IsOptional() @IsNumberString() pageSize?: string;
}

class InventoryMovementsQueryDto {
  @IsOptional() @IsString() companyId?: string;
  @IsOptional() @IsString() divisionId?: string;
  @IsOptional() @IsString() productId?: string;
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsString() locationId?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() dateFrom?: string;
  @IsOptional() @IsString() dateTo?: string;
  @IsOptional() @IsNumberString() page?: string;
  @IsOptional() @IsNumberString() pageSize?: string;
}

class OperationsReportQueryDto {
  @IsOptional() @IsString() companyId?: string;
  @IsOptional() @IsString() divisionId?: string;
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsString() locationId?: string;
  @IsOptional() @IsString() productId?: string;
  @IsOptional() @IsString() customerId?: string;
  @IsOptional() @IsString() supplierId?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() paymentStatus?: string;
  @IsOptional() @IsString() dateFrom?: string;
  @IsOptional() @IsString() dateTo?: string;
  @IsOptional() @IsNumberString() pageSize?: string;
  @IsOptional() @IsNumberString() limit?: string;
}

@Controller('operations-reports')
export class OperationsReportsController {
  constructor(private readonly service: OperationsReportsService) {}

  @Get('stock-valuation')
  @RequirePermissions('operations.reports.view')
  getStockValuation(@Query() q: StockValuationQueryDto, @CurrentUser() user: AuthUser) {
    return this.service.getStockValuation(
      q.companyId,
      q.branchId ?? q.locationId,
      q.divisionId,
      user,
      q.productId,
    );
  }

  @Get('sales-summary')
  @RequirePermissions('operations.reports.view')
  getSalesSummary(@Query() q: SalesSummaryQueryDto, @CurrentUser() user: AuthUser) {
    return this.service.getSalesSummary(q.companyId, q.dateFrom, q.dateTo, q.divisionId, user);
  }

  @Get('purchase-summary')
  @RequirePermissions('operations.reports.view')
  getPurchaseSummary(@Query() q: PurchaseSummaryQueryDto, @CurrentUser() user: AuthUser) {
    return this.service.getPurchaseSummary(q.companyId, q.dateFrom, q.dateTo, q.divisionId, user);
  }

  @Get('inventory-movements')
  @RequirePermissions('operations.reports.view')
  getInventoryMovements(@Query() q: InventoryMovementsQueryDto, @CurrentUser() user: AuthUser) {
    return this.service.getInventoryMovements(
      q.companyId,
      q.productId,
      q.branchId ?? q.locationId,
      q.dateFrom,
      q.dateTo,
      q.page ? parseInt(q.page, 10) : 1,
      q.pageSize ? parseInt(q.pageSize, 10) : 20,
      q.divisionId,
      user,
    );
  }

  @Get('sales-report')
  @RequirePermissions('operations.reports.view')
  getSalesReport(@Query() q: OperationsReportQueryDto, @CurrentUser() user: AuthUser) {
    return this.service.getSalesReport(q as Record<string, string | undefined>, user);
  }

  @Get('sales-by-customer')
  @RequirePermissions('operations.reports.view')
  getSalesByCustomer(@Query() q: OperationsReportQueryDto, @CurrentUser() user: AuthUser) {
    return this.service.getSalesByCustomer(q as Record<string, string | undefined>, user);
  }

  @Get('sales-by-product')
  @RequirePermissions('operations.reports.view')
  getSalesByProduct(@Query() q: OperationsReportQueryDto, @CurrentUser() user: AuthUser) {
    return this.service.getSalesByProduct(q as Record<string, string | undefined>, user);
  }

  @Get('customer-product-sales')
  @RequirePermissions('operations.reports.view')
  getCustomerProductSales(@Query() q: OperationsReportQueryDto, @CurrentUser() user: AuthUser) {
    return this.service.getCustomerProductSales(q as Record<string, string | undefined>, user);
  }

  @Get('purchase-report')
  @RequirePermissions('operations.reports.view')
  getPurchaseReport(@Query() q: OperationsReportQueryDto, @CurrentUser() user: AuthUser) {
    return this.service.getPurchaseReport(q as Record<string, string | undefined>, user);
  }

  @Get('purchases-by-supplier')
  @RequirePermissions('operations.reports.view')
  getPurchasesBySupplier(@Query() q: OperationsReportQueryDto, @CurrentUser() user: AuthUser) {
    return this.service.getPurchasesBySupplier(q as Record<string, string | undefined>, user);
  }

  @Get('purchases-by-product')
  @RequirePermissions('operations.reports.view')
  getPurchasesByProduct(@Query() q: OperationsReportQueryDto, @CurrentUser() user: AuthUser) {
    return this.service.getPurchasesByProduct(q as Record<string, string | undefined>, user);
  }

  @Get('supplier-product-purchases')
  @RequirePermissions('operations.reports.view')
  getSupplierProductPurchases(@Query() q: OperationsReportQueryDto, @CurrentUser() user: AuthUser) {
    return this.service.getSupplierProductPurchases(q as Record<string, string | undefined>, user);
  }

  @Get('low-stock')
  @RequirePermissions('operations.reports.view')
  getLowStock(@Query() q: OperationsReportQueryDto, @CurrentUser() user: AuthUser) {
    return this.service.getLowStock(q as Record<string, string | undefined>, user);
  }

  @Get('stock-adjustments')
  @RequirePermissions('operations.reports.view')
  getStockAdjustments(@Query() q: OperationsReportQueryDto, @CurrentUser() user: AuthUser) {
    return this.service.getStockAdjustments(q as Record<string, string | undefined>, user);
  }

  @Get('stock-ageing')
  @RequirePermissions('operations.reports.view')
  getStockAgeing(@Query() q: OperationsReportQueryDto, @CurrentUser() user: AuthUser) {
    return this.service.getStockAgeing(q as Record<string, string | undefined>, user);
  }

  @Get('branch-profitability')
  @RequirePermissions('operations.reports.view')
  getBranchProfitability(@Query() q: OperationsReportQueryDto, @CurrentUser() user: AuthUser) {
    return this.service.getBranchProfitability(q as Record<string, string | undefined>, user);
  }
}
