import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { AuditAdjustmentsService } from './audit-adjustments.service';
import {
  CreateAuditAdjustmentDto,
  QueryAuditAdjustmentDto,
  ReverseAuditAdjustmentDto,
} from './dto/audit-adjustment.dto';

@Controller('audit-adjustments')
export class AuditAdjustmentsController {
  constructor(private readonly service: AuditAdjustmentsService) {}

  @Get()
  @RequirePermissions('audit_adjustments.list')
  findAll(@Query() query: QueryAuditAdjustmentDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get(':id')
  @RequirePermissions('audit_adjustments.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('audit_adjustments.create')
  create(@Body() dto: CreateAuditAdjustmentDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Post(':id/submit')
  @RequirePermissions('audit_adjustments.create')
  submit(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.submit(id, user);
  }

  @Post(':id/approve')
  @RequirePermissions('audit_adjustments.approve')
  approve(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.approve(id, user);
  }

  @Post(':id/post')
  @RequirePermissions('audit_adjustments.post')
  post(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.post(id, user);
  }

  @Post(':id/reverse')
  @RequirePermissions('audit_adjustments.post')
  reverse(
    @Param('id') id: string,
    @Body() body: ReverseAuditAdjustmentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.reverse(id, body?.reason, user);
  }
}
