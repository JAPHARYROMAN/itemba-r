import { Controller, Get, Query } from '@nestjs/common';
import { OperationsReportsService } from './operations-reports.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { IsOptional, IsString, IsNumberString } from 'class-validator';

class StockValuationQueryDto {
  @IsOptional() @IsString() companyId?: string;
  @IsOptional() @IsString() divisionId?: string;
  @IsOptional() @IsString() locationId?: string;
}

class SalesSummaryQueryDto {
  @IsOptional() @IsString() companyId?: string;
  @IsOptional() @IsString() divisionId?: string;
  @IsOptional() @IsString() dateFrom?: string;
  @IsOptional() @IsString() dateTo?: string;
}

class PurchaseSummaryQueryDto {
  @IsOptional() @IsString() companyId?: string;
  @IsOptional() @IsString() divisionId?: string;
  @IsOptional() @IsString() dateFrom?: string;
  @IsOptional() @IsString() dateTo?: string;
}

class InventoryMovementsQueryDto {
  @IsOptional() @IsString() companyId?: string;
  @IsOptional() @IsString() divisionId?: string;
  @IsOptional() @IsString() productId?: string;
  @IsOptional() @IsString() locationId?: string;
  @IsOptional() @IsString() dateFrom?: string;
  @IsOptional() @IsString() dateTo?: string;
  @IsOptional() @IsNumberString() page?: string;
  @IsOptional() @IsNumberString() pageSize?: string;
}

@Controller('operations-reports')
export class OperationsReportsController {
  constructor(private readonly service: OperationsReportsService) {}

  @Get('stock-valuation')
  @RequirePermissions('operations.reports.view')
  getStockValuation(@Query() q: StockValuationQueryDto, @CurrentUser() user: AuthUser) {
    return this.service.getStockValuation(q.companyId, q.locationId, q.divisionId, user);
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
      q.locationId,
      q.dateFrom,
      q.dateTo,
      q.page ? parseInt(q.page, 10) : 1,
      q.pageSize ? parseInt(q.pageSize, 10) : 20,
      q.divisionId,
      user,
    );
  }
}
