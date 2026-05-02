import { Body, Controller, Delete, Get, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { UserPreferencesService, UpsertUserPreferenceDto } from './user-preferences.service';

@Controller('user-preferences')
@UseGuards(JwtAuthGuard)
export class UserPreferencesController {
  constructor(private readonly service: UserPreferencesService) {}

  @Get('me')
  getMine(@CurrentUser() user: AuthUser) {
    return this.service.getMine(user.id);
  }

  @Put('me')
  upsertMine(@CurrentUser() user: AuthUser, @Body() dto: UpsertUserPreferenceDto) {
    return this.service.upsertMine(user.id, dto);
  }

  @Delete('me')
  resetMine(@CurrentUser() user: AuthUser) {
    return this.service.resetMine(user.id);
  }
}
