import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
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
  paye(@Query('companyId') companyId: string, @Query('year') year: string, @Query('month') month: string) {
    return this.service.payeReturn(this.parseFilter(companyId, year, month));
  }

  @Get('nssf')
  @RequirePermissions('payroll.view')
  nssf(@Query('companyId') companyId: string, @Query('year') year: string, @Query('month') month: string) {
    return this.service.nssfReturn(this.parseFilter(companyId, year, month));
  }

  @Get('psssf')
  @RequirePermissions('payroll.view')
  psssf(@Query('companyId') companyId: string, @Query('year') year: string, @Query('month') month: string) {
    return this.service.psssfReturn(this.parseFilter(companyId, year, month));
  }

  @Get('wcf')
  @RequirePermissions('payroll.view')
  wcf(@Query('companyId') companyId: string, @Query('year') year: string, @Query('month') month: string) {
    return this.service.wcfReturn(this.parseFilter(companyId, year, month));
  }

  @Get('sdl')
  @RequirePermissions('payroll.view')
  sdl(@Query('companyId') companyId: string, @Query('year') year: string, @Query('month') month: string) {
    return this.service.sdlReturn(this.parseFilter(companyId, year, month));
  }

  @Get('nhif')
  @RequirePermissions('payroll.view')
  nhif(@Query('companyId') companyId: string, @Query('year') year: string, @Query('month') month: string) {
    return this.service.nhifReturn(this.parseFilter(companyId, year, month));
  }

  @Get('heslb')
  @RequirePermissions('payroll.view')
  heslb(@Query('companyId') companyId: string, @Query('year') year: string, @Query('month') month: string) {
    return this.service.heslbReturn(this.parseFilter(companyId, year, month));
  }

  @Get('all')
  @RequirePermissions('payroll.view')
  all(@Query('companyId') companyId: string, @Query('year') year: string, @Query('month') month: string) {
    return this.service.generateAll(this.parseFilter(companyId, year, month));
  }
}
