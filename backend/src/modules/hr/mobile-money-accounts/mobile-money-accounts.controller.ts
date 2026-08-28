import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../../common/decorators/current-user.decorator';
import { MobileMoneyAccountsService } from './mobile-money-accounts.service';
import { CreateMobileMoneyAccountDto } from './dto/create-mobile-money-account.dto';
import { UpdateMobileMoneyAccountDto } from './dto/update-mobile-money-account.dto';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('hr/mobile-money-accounts')
export class MobileMoneyAccountsController {
  constructor(private readonly service: MobileMoneyAccountsService) {}

  @Get()
  @RequirePermissions('employees.view')
  findByEmployee(@Query('employeeId') employeeId: string, @CurrentUser() user: AuthUser) {
    return this.service.findByEmployee(employeeId, user);
  }

  @Post()
  @RequirePermissions('employees.update')
  create(@Body() dto: CreateMobileMoneyAccountDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.id);
  }

  @Patch(':id')
  @RequirePermissions('employees.update')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateMobileMoneyAccountDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.update(id, dto, user.id);
  }

  @Delete(':id')
  @RequirePermissions('employees.update')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }
}
