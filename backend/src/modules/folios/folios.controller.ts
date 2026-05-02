import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { FoliosService } from './folios.service';
import { PostFolioChargeDto } from './dto/post-charge.dto';
import { SettleFolioDto } from './dto/settle-folio.dto';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('hospitality/folios')
export class FoliosController {
  constructor(private readonly service: FoliosService) {}

  @Get('booking/:bookingId')
  @RequirePermissions('hospitality.bookings.view')
  byBooking(@Param('bookingId') bookingId: string) {
    return this.service.findByBooking(bookingId);
  }

  @Get(':id')
  @RequirePermissions('hospitality.bookings.view')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post('booking/:bookingId/open')
  @RequirePermissions('hospitality.bookings.update')
  open(@Param('bookingId') bookingId: string, @CurrentUser() user: AuthUser) {
    return this.service.openForBooking(bookingId, user.id);
  }

  @Post(':id/charges')
  @RequirePermissions('hospitality.bookings.update')
  postCharge(@Param('id') id: string, @Body() dto: PostFolioChargeDto, @CurrentUser() user: AuthUser) {
    return this.service.postCharge(id, dto, user.id);
  }

  @Patch(':id/checkout')
  @RequirePermissions('hospitality.bookings.update')
  checkout(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.checkout(id, user.id);
  }

  /**
   * Settle a folio at checkout — closes it AND creates a settlement
   * SalesOrder. The right path for normal hotel checkouts.
   */
  @Patch(':id/settle')
  @RequirePermissions('hospitality.bookings.update')
  settle(@Param('id') id: string, @Body() dto: SettleFolioDto, @CurrentUser() user: AuthUser) {
    return this.service.settle(id, user, dto);
  }

  @Patch(':id/cancel')
  @RequirePermissions('hospitality.bookings.update')
  cancel(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.cancel(id, user.id);
  }
}
