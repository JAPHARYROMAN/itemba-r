import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ComplianceEventsQueryDto } from '../../../common/dto/resource-query.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../../common/decorators/current-user.decorator';
import { ComplianceEventsService } from './compliance-events.service';
import { CreateComplianceEventDto } from './dto/create-compliance-event.dto';
import { UpdateComplianceEventDto } from './dto/update-compliance-event.dto';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('compliance/events')
export class ComplianceEventsController {
  constructor(private readonly service: ComplianceEventsService) {}

  @Get()
  @RequirePermissions('compliance_events.view')
  findAll(@CurrentUser() user: AuthUser, @Query() query: ComplianceEventsQueryDto) {
    return this.service.findAll(user, query);
  }

  @Get(':id')
  @RequirePermissions('compliance_events.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('compliance_events.manage')
  create(@Body() dto: CreateComplianceEventDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Put(':id')
  @RequirePermissions('compliance_events.manage')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateComplianceEventDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('compliance_events.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }
}
