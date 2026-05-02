import { Controller, Get, Query } from '@nestjs/common';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { AccountingEngineService } from './accounting-engine.service';

@Controller('accounting-engine')
export class AccountingEngineController {
  constructor(private readonly service: AccountingEngineService) {}

  @Get('summary')
  @RequirePermissions('accounting_engine.dashboard')
  getSummary(@Query() query: any) {
    return this.service.getSummary(query);
  }
}
