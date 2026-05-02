import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { FuelDailyReconciliationService } from './fuel-daily-reconciliation.service';
import { GenerateReconciliationDto } from './dto/generate-reconciliation.dto';
import { UpdateReconciliationDto } from './dto/update-reconciliation.dto';

@Controller('petroleum/daily-reconciliations')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class FuelDailyReconciliationController {
  constructor(private readonly service: FuelDailyReconciliationService) {}

  @Post('generate')
  @RequirePermissions('fuel_reconciliation.create')
  generate(@Body() dto: GenerateReconciliationDto, @CurrentUser() user: AuthUser) {
    return this.service.generate(dto, user);
  }

  @Get()
  @RequirePermissions('fuel_reconciliation.view')
  findAll(@Query() query: Record<string, string>) {
    return this.service.findAll(query);
  }

  @Get(':id')
  @RequirePermissions('fuel_reconciliation.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Patch(':id')
  @RequirePermissions('fuel_reconciliation.create')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateReconciliationDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @Patch(':id/submit')
  @RequirePermissions('fuel_reconciliation.create')
  submit(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.submit(id, user);
  }

  @Patch(':id/approve')
  @RequirePermissions('fuel_reconciliation.approve')
  approve(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.approve(id, user);
  }

  @Patch(':id/post')
  @RequirePermissions('fuel_reconciliation.post')
  post(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.post(id, user);
  }

  @Delete(':id')
  @RequirePermissions('fuel_reconciliation.create')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }
}
