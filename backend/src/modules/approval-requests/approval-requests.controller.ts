import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { ApprovalRequestsService } from './approval-requests.service';
import { CreateApprovalRequestDto } from './dto/create-approval-request.dto';
import { ApprovalActionDto } from './dto/approval-action.dto';

@ApiTags('Approval Requests')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('approvals/requests')
export class ApprovalRequestsController {
  constructor(private readonly service: ApprovalRequestsService) {}

  // IMPORTANT: Static routes BEFORE :id routes to prevent route conflicts

  @Get('readiness')
  @RequirePermissions('approval_requests.view')
  getReadiness(@CurrentUser() user: AuthUser, @Query() query: any) {
    return this.service.getReadiness(user, query);
  }

  @Get('pending/me')
  @RequirePermissions('approval_requests.view')
  pendingForMe(@CurrentUser() user: AuthUser, @Query() query: any) {
    return this.service.findPendingForMe(user, query);
  }

  @Get('submitted-by/me')
  @RequirePermissions('approval_requests.view')
  submittedByMe(@CurrentUser() user: AuthUser, @Query() query: any) {
    return this.service.findSubmittedByMe(user, query);
  }

  @Get()
  @RequirePermissions('approval_requests.view')
  findAll(@CurrentUser() user: AuthUser, @Query() query: any) {
    return this.service.findAll(user, query);
  }

  @Get(':id')
  @RequirePermissions('approval_requests.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('approval_requests.create')
  create(@Body() dto: CreateApprovalRequestDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Patch(':id/submit')
  @RequirePermissions('approval_requests.create')
  submit(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.submit(id, user);
  }

  @Patch(':id/approve')
  @RequirePermissions('approval_requests.approve')
  approve(@Param('id') id: string, @Body() dto: ApprovalActionDto, @CurrentUser() user: AuthUser) {
    return this.service.approve(id, dto, user);
  }

  @Patch(':id/reject')
  @RequirePermissions('approval_requests.reject')
  reject(@Param('id') id: string, @Body() dto: ApprovalActionDto, @CurrentUser() user: AuthUser) {
    return this.service.reject(id, dto, user);
  }

  @Patch(':id/cancel')
  @RequirePermissions('approval_requests.cancel')
  cancel(@Param('id') id: string, @Body() dto: ApprovalActionDto, @CurrentUser() user: AuthUser) {
    return this.service.cancel(id, dto, user);
  }

  @Post(':id/comment')
  @RequirePermissions('approval_requests.view')
  addComment(
    @Param('id') id: string,
    @Body() dto: ApprovalActionDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.addComment(id, dto, user);
  }
}
