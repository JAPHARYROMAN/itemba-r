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
import { ApprovalWorkflowsQueryDto } from '../../common/dto/resource-query.dto';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { ApprovalWorkflowsService } from './approval-workflows.service';
import { CreateApprovalWorkflowDto } from './dto/create-approval-workflow.dto';
import { UpdateApprovalWorkflowDto } from './dto/update-approval-workflow.dto';

@ApiTags('Approval Workflows')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('approvals/workflows')
export class ApprovalWorkflowsController {
  constructor(private readonly service: ApprovalWorkflowsService) {}

  @Get()
  @RequirePermissions('approval_workflows.view')
  findAll(@CurrentUser() user: AuthUser, @Query() query: ApprovalWorkflowsQueryDto) {
    return this.service.findAll(user, query);
  }

  @Get(':id')
  @RequirePermissions('approval_workflows.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('approval_workflows.manage')
  create(@Body() dto: CreateApprovalWorkflowDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Patch(':id')
  @RequirePermissions('approval_workflows.manage')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateApprovalWorkflowDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @Patch(':id/activate')
  @RequirePermissions('approval_workflows.manage')
  activate(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.activate(id, user);
  }

  @Patch(':id/deactivate')
  @RequirePermissions('approval_workflows.manage')
  deactivate(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.deactivate(id, user);
  }

  @Delete(':id')
  @RequirePermissions('approval_workflows.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }
}
