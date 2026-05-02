import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { ApprovalStepsService } from './approval-steps.service';
import { CreateApprovalStepDto } from './dto/create-approval-step.dto';
import { UpdateApprovalStepDto } from './dto/update-approval-step.dto';

@ApiTags('Approval Steps')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('approvals')
export class ApprovalStepsController {
  constructor(private readonly service: ApprovalStepsService) {}

  @Get('workflows/:workflowId/steps')
  @RequirePermissions('approval_steps.view')
  findByWorkflow(@Param('workflowId') workflowId: string, @CurrentUser() user: AuthUser) {
    return this.service.findByWorkflow(workflowId, user);
  }

  @Post('workflows/:workflowId/steps')
  @RequirePermissions('approval_steps.manage')
  create(@Param('workflowId') workflowId: string, @Body() dto: CreateApprovalStepDto, @CurrentUser() user: AuthUser) {
    return this.service.create(workflowId, dto, user);
  }

  @Patch('steps/:id')
  @RequirePermissions('approval_steps.manage')
  update(@Param('id') id: string, @Body() dto: UpdateApprovalStepDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user);
  }

  @Delete('steps/:id')
  @RequirePermissions('approval_steps.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }
}
