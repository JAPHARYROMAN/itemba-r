import { Controller, Get, Query } from '@nestjs/common';
import { OperationsDashboardService } from './operations-dashboard.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { IsOptional, IsString } from 'class-validator';

class DashboardQueryDto {
  @IsOptional() @IsString() companyId?: string;
}

@Controller('operations-dashboard')
export class OperationsDashboardController {
  constructor(private readonly service: OperationsDashboardService) {}

  @Get('summary')
  @RequirePermissions('operations.dashboard.view')
  getSummary(@Query() q: DashboardQueryDto, @CurrentUser() user: AuthUser) {
    return this.service.getSummary(q.companyId, user);
  }
}
