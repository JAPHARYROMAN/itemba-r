import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { AlertRulesService } from './alert-rules.service';
import { CreateAlertRuleDto } from './dto/create-alert-rule.dto';

@ApiTags('Alert Rules')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('alert-rules')
export class AlertRulesController {
  constructor(private readonly service: AlertRulesService) {}

  @Get()
  @RequirePermissions('alert_rules.view')
  findAll(@CurrentUser() user: AuthUser, @Query() query: any) {
    return this.service.findAll(user, query);
  }

  @Get(':id')
  @RequirePermissions('alert_rules.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('alert_rules.manage')
  create(@Body() dto: CreateAlertRuleDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Patch(':id')
  @RequirePermissions('alert_rules.manage')
  update(@Param('id') id: string, @Body() dto: Partial<CreateAlertRuleDto>, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user);
  }

  @Patch(':id/activate')
  @RequirePermissions('alert_rules.manage')
  activate(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.activate(id, user);
  }

  @Patch(':id/deactivate')
  @RequirePermissions('alert_rules.manage')
  deactivate(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.deactivate(id, user);
  }

  @Delete(':id')
  @RequirePermissions('alert_rules.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }
}
