import { Controller, Get, Param, Query } from '@nestjs/common';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CustomerPerformanceQueryDto } from './customer-performance.dto';
import { CustomerPerformanceService } from './customer-performance.service';

@Controller('customer-performance')
export class CustomerPerformanceController {
  constructor(private readonly service: CustomerPerformanceService) {}

  @Get()
  @RequirePermissions('customers.view', 'sales.view')
  read(@Query() query: CustomerPerformanceQueryDto, @CurrentUser() user: AuthUser) {
    return this.service.read(user, query);
  }

  @Get(':id/history')
  @RequirePermissions('customers.view', 'sales.view')
  history(
    @Param('id') id: string,
    @Query() query: CustomerPerformanceQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.history(user, id, query);
  }
}
