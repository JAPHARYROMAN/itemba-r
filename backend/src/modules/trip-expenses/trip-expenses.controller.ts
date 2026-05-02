import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { TripExpensesService } from './trip-expenses.service';
import { CreateTripExpenseDto } from './dto/create-trip-expense.dto';
import { UpdateTripExpenseDto } from './dto/update-trip-expense.dto';

@Controller('logistics/trip-expenses')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TripExpensesController {
  constructor(private service: TripExpensesService) {}

  @Post() @RequirePermissions('trip_expenses.manage')
  create(@Body() dto: CreateTripExpenseDto, @CurrentUser() user: AuthUser) { return this.service.create(dto, user.id); }

  @Get() @RequirePermissions('trip_expenses.view')
  findAll(@Query('companyId') companyId?: string, @Query('page') page?: string, @Query('limit') limit?: string, @CurrentUser() user: AuthUser = undefined as unknown as AuthUser) {
    return this.service.findAll(companyId, page ? +page : 1, limit ? +limit : 20, user);
  }

  @Get('by-trip/:tripId') @RequirePermissions('trip_expenses.view')
  findByTrip(@Param('tripId') tripId: string) { return this.service.findByTrip(tripId); }

  @Get(':id') @RequirePermissions('trip_expenses.view')
  findOne(@Param('id') id: string) { return this.service.findOne(id); }

  @Put(':id') @RequirePermissions('trip_expenses.manage')
  update(@Param('id') id: string, @Body() dto: UpdateTripExpenseDto, @CurrentUser() user: AuthUser) { return this.service.update(id, dto, user.id); }

  @Delete(':id') @RequirePermissions('trip_expenses.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.service.remove(id, user.id); }
}
