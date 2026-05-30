import { Controller, Get, Query } from '@nestjs/common';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { AccountingEngineService } from './accounting-engine.service';
import { AccountingEngineSummaryQueryDto } from './dto/accounting-engine-query.dto';

@Controller('accounting-engine')
export class AccountingEngineController {
  constructor(private readonly service: AccountingEngineService) {}

  @Get('summary')
  @RequirePermissions('accounting_engine.dashboard')
  getSummary(@Query() query: AccountingEngineSummaryQueryDto, @CurrentUser() user: AuthUser) {
    return this.service.getSummary(query, user);
  }

  @Get('readiness')
  @RequirePermissions('accounting_engine.dashboard')
  getReadiness(@Query() query: AccountingEngineSummaryQueryDto, @CurrentUser() user: AuthUser) {
    return this.service.getReadiness(query, user);
  }
}
