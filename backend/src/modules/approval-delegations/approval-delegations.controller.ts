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
import { ApprovalDelegationsQueryDto } from '../../common/dto/resource-query.dto';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { AgentExcluded } from '../../common/decorators/agent-excluded.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { ApprovalDelegationsService } from './approval-delegations.service';
import {
  CreateApprovalDelegationDto,
  UpdateApprovalDelegationDto,
} from './dto/create-approval-delegation.dto';

@ApiTags('Approval Delegations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('approvals/delegations')
export class ApprovalDelegationsController {
  constructor(private readonly service: ApprovalDelegationsService) {}

  @Get()
  @RequirePermissions('approval_delegations.view')
  findAll(@CurrentUser() user: AuthUser, @Query() query: ApprovalDelegationsQueryDto) {
    return this.service.findAll(user, query);
  }

  @Get(':id')
  @RequirePermissions('approval_delegations.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  // The ITEMBA OS redesign (4a155f19) changed this body DTO to conditional
  // validation the agent schema cannot represent strictly; it stays
  // agent-excluded (fail closed) until re-reviewed.
  @Post()
  @AgentExcluded()
  @RequirePermissions('approval_delegations.manage')
  create(@Body() dto: CreateApprovalDelegationDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  // The ITEMBA OS redesign (4a155f19) changed this body DTO to conditional
  // validation the agent schema cannot represent strictly; it stays
  // agent-excluded (fail closed) until re-reviewed.
  @Patch(':id')
  @AgentExcluded()
  @RequirePermissions('approval_delegations.manage')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateApprovalDelegationDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @Patch(':id/cancel')
  @RequirePermissions('approval_delegations.manage')
  cancel(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.cancel(id, user);
  }

  @Delete(':id')
  @RequirePermissions('approval_delegations.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }
}
