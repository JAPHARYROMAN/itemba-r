import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AgentExcluded } from '../../common/decorators/agent-excluded.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RecentAuth } from '../../common/decorators/recent-auth.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { RecentAuthGuard } from '../../common/guards/recent-auth.guard';
import { DisableMsaidiziAutopilotDto, EnableMsaidiziAutopilotDto } from './dto/msaidizi-safety.dto';
import { MsaidiziSafetyService } from './msaidizi-safety.service';

@ApiTags('msaidizi-safety')
@ApiBearerAuth()
@AgentExcluded()
@RequirePermissions('msaidizi.use', 'msaidizi.oversight')
@Controller('msaidizi/safety')
export class MsaidiziSafetyController {
  constructor(private readonly safety: MsaidiziSafetyService) {}

  @Get()
  @ApiOperation({ summary: 'Read deployment and operator Autopilot safety state' })
  status() {
    return this.safety.status();
  }

  @Post('disable-autopilot')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 3 } })
  @UseGuards(RecentAuthGuard)
  @RecentAuth(15)
  @ApiOperation({ summary: 'Stop new durable dispatches and pause active autonomous work' })
  disable(@Body() _dto: DisableMsaidiziAutopilotDto, @CurrentUser() user: AuthUser) {
    return this.safety.disable(user);
  }

  @Post('enable-autopilot')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 3 } })
  @UseGuards(RecentAuthGuard)
  @RecentAuth(15)
  @ApiOperation({ summary: 'Release the operator latch without resuming tasks or routines' })
  enable(@Body() _dto: EnableMsaidiziAutopilotDto, @CurrentUser() user: AuthUser) {
    return this.safety.enable(user);
  }
}
