import { Controller, Post, Body } from '@nestjs/common';
import { GoLiveSignoffService } from './go-live-signoff.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@Controller('go-live')
export class GoLiveSignoffController {
  constructor(private readonly service: GoLiveSignoffService) {}

  @Post('signoff')
  @RequirePermissions('final_qa.go_live_signoff')
  signoff(@Body() dto: any, @CurrentUser() user: AuthUser) {
    return this.service.signoff(dto, user.id);
  }
}
