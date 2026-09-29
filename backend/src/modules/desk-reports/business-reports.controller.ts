import { Controller, Get, Query } from '@nestjs/common';
import { IsIn, IsOptional, IsString, Matches, IsDateString } from 'class-validator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { AgentExcluded } from '../../common/decorators/agent-excluded.decorator';
import { BusinessReportsService } from './business-reports.service';
export class BusinessReportQuery {
  @IsIn(['sales', 'customers', 'suppliers', 'expenses', 'accounts']) kind!:
    | 'sales'
    | 'customers'
    | 'suppliers'
    | 'expenses'
    | 'accounts';
  @IsOptional() @IsString() companyId?: string;
  @IsOptional() @IsString() divisionId?: string;
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) from?: string;
  @IsOptional() @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) to?: string;
  @IsOptional() @IsIn(['TZS', 'KES', 'UGX', 'USD', 'EUR', 'GBP']) currency?: string;
}
@Controller('desk-reports/business')
@AgentExcluded()
export class BusinessReportsController {
  constructor(private readonly service: BusinessReportsService) {}
  // Each dataset enforces its own action permission in the service, before any reads.
  @Get() read(@CurrentUser() user: AuthUser, @Query() q: BusinessReportQuery) {
    return this.service.read(user, q);
  }
  @Get('directory') directory(@CurrentUser() user: AuthUser) {
    return this.service.directory(user);
  }
}
