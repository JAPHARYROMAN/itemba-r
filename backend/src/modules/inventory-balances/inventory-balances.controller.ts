import { Controller, Get, Param, Query } from '@nestjs/common';
import { InventoryBalancesService } from './inventory-balances.service';
import { QueryInventoryBalanceDto } from './dto/query-inventory-balance.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@Controller('inventory-balances')
export class InventoryBalancesController {
  constructor(private readonly service: InventoryBalancesService) {}

  @Get()
  @RequirePermissions('inventory.view')
  findAll(@Query() query: QueryInventoryBalanceDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get('summary')
  @RequirePermissions('inventory.view')
  summary(@Query() query: QueryInventoryBalanceDto, @CurrentUser() user: AuthUser) {
    return this.service.summary(query, user);
  }

  /** Live stock heatmap — per-location grouping with OUT/LOW/OK counts. */
  @Get('live')
  @RequirePermissions('inventory.view')
  live(
    @Query('companyId') companyId: string,
    @CurrentUser() user: AuthUser,
    @Query('branchId') branchId?: string,
    @Query('lowThreshold') lowThreshold?: string,
    @Query('search') search?: string,
  ) {
    return this.service.liveStock(
      {
        companyId,
        branchId,
        lowThreshold: lowThreshold ? Number(lowThreshold) : undefined,
        search,
      },
      user,
    );
  }

  @Get(':id')
  @RequirePermissions('inventory.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }
}
