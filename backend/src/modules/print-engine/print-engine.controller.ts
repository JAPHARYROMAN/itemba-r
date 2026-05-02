import { Controller, Post, Body } from '@nestjs/common';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { PrintEngineService } from './print-engine.service';

@Controller('print-engine')
export class PrintEngineController {
  constructor(private readonly service: PrintEngineService) {}

  @Post('render')
  @RequirePermissions('print_engine.render')
  render(@Body() dto: any, @CurrentUser() user: AuthUser) {
    return this.service.render(dto, user);
  }
}
