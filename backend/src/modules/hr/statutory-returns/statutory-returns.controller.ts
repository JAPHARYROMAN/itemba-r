import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../../common/decorators/current-user.decorator';
import { StatutoryReturnsService } from './statutory-returns.service';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('hr/statutory-returns')
export class StatutoryReturnsController {
  constructor(private readonly service: StatutoryReturnsService) {}

  private parseFilter(companyId: string, year: string, month: string) {
    return {
      companyId,
      year: Number(year),
      month: Number(month),
    };
  }

  @Get('paye')
  @RequirePermissions('payroll.view')
  paye(
    @CurrentUser() user: AuthUser,
    @Query('companyId') companyId: string,
    @Query('year') year: string,
    @Query('month') month: string,
  ) {
    return this.service.payeReturn(user, this.parseFilter(companyId, year, month));
  }

  @Get('nssf')
  @RequirePermissions('payroll.view')
  nssf(
    @CurrentUser() user: AuthUser,
    @Query('companyId') companyId: string,
    @Query('year') year: string,
    @Query('month') month: string,
  ) {
    return this.service.nssfReturn(user, this.parseFilter(companyId, year, month));
  }

  @Get('psssf')
  @RequirePermissions('payroll.view')
  psssf(
    @CurrentUser() user: AuthUser,
    @Query('companyId') companyId: string,
    @Query('year') year: string,
    @Query('month') month: string,
  ) {
    return this.service.psssfReturn(user, this.parseFilter(companyId, year, month));
  }

  @Get('wcf')
  @RequirePermissions('payroll.view')
  wcf(
    @CurrentUser() user: AuthUser,
    @Query('companyId') companyId: string,
    @Query('year') year: string,
    @Query('month') month: string,
  ) {
    return this.service.wcfReturn(user, this.parseFilter(companyId, year, month));
  }

  @Get('sdl')
  @RequirePermissions('payroll.view')
  sdl(
    @CurrentUser() user: AuthUser,
    @Query('companyId') companyId: string,
    @Query('year') year: string,
    @Query('month') month: string,
  ) {
    return this.service.sdlReturn(user, this.parseFilter(companyId, year, month));
  }

  @Get('nhif')
  @RequirePermissions('payroll.view')
  nhif(
    @CurrentUser() user: AuthUser,
    @Query('companyId') companyId: string,
    @Query('year') year: string,
    @Query('month') month: string,
  ) {
    return this.service.nhifReturn(user, this.parseFilter(companyId, year, month));
  }

  @Get('heslb')
  @RequirePermissions('payroll.view')
  heslb(
    @CurrentUser() user: AuthUser,
    @Query('companyId') companyId: string,
    @Query('year') year: string,
    @Query('month') month: string,
  ) {
    return this.service.heslbReturn(user, this.parseFilter(companyId, year, month));
  }

  @Get('all')
  @RequirePermissions('payroll.view')
  all(
    @CurrentUser() user: AuthUser,
    @Query('companyId') companyId: string,
    @Query('year') year: string,
    @Query('month') month: string,
  ) {
    return this.service.generateAll(user, this.parseFilter(companyId, year, month));
  }
}
