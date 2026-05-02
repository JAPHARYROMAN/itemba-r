import { Controller, Get, Query } from '@nestjs/common';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { ProcurementService } from './procurement.service';

@Controller('procurement')
export class ProcurementController {
  constructor(private readonly service: ProcurementService) {}

  @Get('summary')
  @RequirePermissions('procurement.dashboard')
  getSummary(@Query() query: any, @CurrentUser() user: AuthUser) {
    return this.service.getSummary(query, user);
  }
}
