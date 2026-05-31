import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common';
import { FuelShiftsService } from './fuel-shifts.service';
import { OpenFuelShiftDto } from './dto/open-fuel-shift.dto';
import { UpdateFuelShiftDto, RejectFuelShiftDto } from './dto/update-fuel-shift.dto';
import { CloseFuelShiftDto } from './dto/close-fuel-shift.dto';
import { AddShiftAttendantDto, UpdateShiftAttendantDto } from './dto/manage-attendants.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@Controller('petroleum/fuel-shifts')
export class FuelShiftsController {
  constructor(private readonly service: FuelShiftsService) {}

  @Post('open')
  @RequirePermissions('fuel_shifts.open')
  open(@Body() dto: OpenFuelShiftDto, @CurrentUser() user: AuthUser) {
    return this.service.openShift(dto, user);
  }

  @Get()
  @RequirePermissions('fuel_shifts.view')
  findAll(
    @CurrentUser() user: AuthUser,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('companyId') companyId?: string,
    @Query('divisionId') divisionId?: string,
    @Query('branchId') branchId?: string,
    @Query('status') status?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.service.findAll(
      {
        page: page ? Number(page) : undefined,
        limit: limit ? Number(limit) : undefined,
        companyId,
        divisionId,
        branchId,
        status,
        dateFrom,
        dateTo,
      },
      user,
    );
  }

  @Get(':id')
  @RequirePermissions('fuel_shifts.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Patch(':id')
  @RequirePermissions('fuel_shifts.update')
  update(@Param('id') id: string, @Body() dto: UpdateFuelShiftDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user);
  }

  @Patch(':id/submit')
  @RequirePermissions('fuel_shifts.submit')
  submit(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.submitShift(id, user);
  }

  @Patch(':id/supervisor-approve')
  @RequirePermissions('fuel_shifts.supervisor_approve')
  supervisorApprove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.supervisorApprove(id, user);
  }

  @Patch(':id/manager-approve')
  @RequirePermissions('fuel_shifts.manager_approve')
  managerApprove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.managerApprove(id, user);
  }

  @Patch(':id/reject')
  @RequirePermissions('fuel_shifts.reject')
  reject(@Param('id') id: string, @Body() dto: RejectFuelShiftDto, @CurrentUser() user: AuthUser) {
    return this.service.rejectShift(id, dto.reason, user);
  }

  @Patch(':id/close')
  @RequirePermissions('fuel_shifts.close')
  close(@Param('id') id: string, @Body() dto: CloseFuelShiftDto, @CurrentUser() user: AuthUser) {
    return this.service.closeShift(id, dto, user);
  }

  @Post(':id/nozzle-readings/sync')
  @RequirePermissions('fuel_shifts.update')
  syncNozzleReadings(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.syncNozzleReadings(id, user);
  }

  @Delete(':id')
  @RequirePermissions('fuel_shifts.close')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }

  // ── Attendant management ────────────────────────────────────────────────

  @Post(':id/attendants')
  @RequirePermissions('fuel_shifts.update')
  addAttendant(
    @Param('id') id: string,
    @Body() dto: AddShiftAttendantDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.addAttendant(id, dto, user);
  }

  @Patch(':id/attendants/:attendantRowId')
  @RequirePermissions('fuel_shifts.update')
  updateAttendant(
    @Param('id') id: string,
    @Param('attendantRowId') attendantRowId: string,
    @Body() dto: UpdateShiftAttendantDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.updateAttendant(id, attendantRowId, dto, user);
  }

  @Delete(':id/attendants/:attendantRowId')
  @RequirePermissions('fuel_shifts.update')
  removeAttendant(
    @Param('id') id: string,
    @Param('attendantRowId') attendantRowId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.removeAttendant(id, attendantRowId, user);
  }

  // ── Per-attendant efficiency ────────────────────────────────────────────

  @Get(':id/efficiency')
  @RequirePermissions('fuel_shifts.view')
  efficiency(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.getAttendantEfficiency(id, user);
  }
}
