import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AgentExcluded } from '../../common/decorators/agent-excluded.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ProposeMsaidiziTaskDto } from './dto/msaidizi-reasoning.dto';
import { MsaidiziReasoningService } from './msaidizi-reasoning.service';

@ApiTags('msaidizi-tasks')
@ApiBearerAuth()
@AgentExcluded()
@RequirePermissions('msaidizi.use')
@Controller('msaidizi/tasks')
export class MsaidiziReasoningController {
  constructor(private readonly reasoning: MsaidiziReasoningService) {}

  @Post('proposals')
  @ApiOperation({
    summary: 'Propose a governed typed task DAG without persisting, queuing, or executing it',
  })
  propose(@Body() dto: ProposeMsaidiziTaskDto, @CurrentUser() user: AuthUser) {
    return this.reasoning.propose(dto, user);
  }
}
