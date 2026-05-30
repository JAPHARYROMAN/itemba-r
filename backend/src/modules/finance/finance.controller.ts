import { Controller, Get, Query } from '@nestjs/common';
import { FinanceService } from './finance.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { IsOptional, IsString } from 'class-validator';

class FinanceDashboardQueryDto {
  @IsOptional()
  @IsString()
  companyId?: string;
}

@Controller('finance')
export class FinanceController {
  constructor(private readonly service: FinanceService) {}

  @Get('dashboard')
  @RequirePermissions('finance.view')
  getDashboard(@Query() q: FinanceDashboardQueryDto, @CurrentUser() user: AuthUser) {
    return this.service.getDashboard(q.companyId, user);
  }
}
