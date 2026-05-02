import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../../common/decorators/current-user.decorator';
import { PetroleumCommissionsService } from './petroleum-commissions.service';
import { CommissionFilterDto } from './dto/commission-filter.dto';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('hr/petroleum-commissions')
export class PetroleumCommissionsController {
  constructor(private readonly service: PetroleumCommissionsService) {}

  /** Compute commissions for a period without persisting anything. */
  @Post('preview')
  @RequirePermissions('payroll.view')
  preview(@Body() dto: CommissionFilterDto) {
    return this.service.preview(dto);
  }

  /** Compute and persist as EmployeeAllowance rows. Idempotent. */
  @Post('commit')
  @RequirePermissions('payroll.manage')
  commit(@Body() dto: CommissionFilterDto, @CurrentUser() user: AuthUser) {
    return this.service.commit(dto, user.id);
  }
}
