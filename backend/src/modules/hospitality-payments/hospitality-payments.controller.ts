import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { HospitalityPaymentsService } from './hospitality-payments.service';
import { CreateHospitalityPaymentDto } from './dto/create-hospitality-payment.dto';

@Controller('hospitality-payments')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class HospitalityPaymentsController {
  constructor(private service: HospitalityPaymentsService) {}

  @Post()
  @RequirePermissions('hospitality_payments.create')
  create(@Body() dto: CreateHospitalityPaymentDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.id);
  }

  @Get()
  @RequirePermissions('hospitality_payments.view')
  findAll(
    @Query('companyId') companyId?: string,
    @Query('roomBookingId') roomBookingId?: string,
    @Query('restaurantOrderId') restaurantOrderId?: string,
    @Query('paymentContextType') paymentContextType?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string, @CurrentUser() user: AuthUser = undefined as unknown as AuthUser,
  ) {
    return this.service.findAll(companyId, roomBookingId, restaurantOrderId, paymentContextType, page ? +page : 1, limit ? +limit : 20, user);
  }

  @Get(':id')
  @RequirePermissions('hospitality_payments.view')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }
}
