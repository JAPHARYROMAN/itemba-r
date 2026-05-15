import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { ParkingPaymentsService } from './parking-payments.service';
import { CreateParkingPaymentDto } from './dto/create-parking-payment.dto';

@Controller('parking-payments')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ParkingPaymentsController {
  constructor(private service: ParkingPaymentsService) {}

  @Post()
  @RequirePermissions('parking_payments.create')
  create(@Body() dto: CreateParkingPaymentDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Get()
  @RequirePermissions('parking_payments.view')
  findAll(
    @Query('companyId') companyId?: string,
    @Query('parkingSessionId') parkingSessionId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @CurrentUser() user: AuthUser = undefined as unknown as AuthUser,
  ) {
    return this.service.findAll(
      companyId,
      parkingSessionId,
      page ? +page : 1,
      limit ? +limit : 20,
      user,
    );
  }

  @Get(':id')
  @RequirePermissions('parking_payments.view')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }
}
