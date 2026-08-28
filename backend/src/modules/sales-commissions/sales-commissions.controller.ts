import { SalesCommissionsQueryDto } from '../../common/dto/resource-query.dto';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { SalesCommissionsService } from './sales-commissions.service';
import { CreateSalesCommissionDto } from './dto/create-sales-commission.dto';
import { UpdateSalesCommissionDto } from './dto/update-sales-commission.dto';
import { CancelSalesCommissionDto } from './dto/cancel-sales-commission.dto';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('sales-commissions')
export class SalesCommissionsController {
  constructor(private readonly service: SalesCommissionsService) {}

  @Get()
  @RequirePermissions('sales_orders.view')
  findAll(@CurrentUser() user: AuthUser, @Query() query: SalesCommissionsQueryDto) {
    return this.service.findAll(user, query);
  }

  @Get(':id')
  @RequirePermissions('sales_orders.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('sales_orders.create')
  create(@Body() dto: CreateSalesCommissionDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Put(':id')
  @RequirePermissions('sales_orders.create')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateSalesCommissionDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @Patch(':id/approve')
  @RequirePermissions('sales_orders.confirm')
  approve(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.approve(id, user);
  }

  @Patch(':id/cancel')
  @RequirePermissions('sales_orders.create')
  cancel(
    @Param('id') id: string,
    @Body() body: CancelSalesCommissionDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.cancel(id, body.reason, user);
  }

  @Delete(':id')
  @RequirePermissions('sales_orders.create')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }
}
