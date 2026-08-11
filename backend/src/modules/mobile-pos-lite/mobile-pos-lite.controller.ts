import { Body, Controller, Get, Headers, Param, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import {
  CreateMobilePosTerminalDto,
  QueryMobilePosTerminalDto,
  UpdateMobilePosTerminalDto,
  UpdateMobilePosTerminalStatusDto,
} from './dto/mobile-pos-terminal.dto';
import {
  ActivateMobilePosTerminalDto,
  QueryMobilePosLiteCatalogDto,
} from './dto/mobile-pos-lite-session.dto';
import { CreateMobilePosLiteSaleDto } from './dto/mobile-pos-lite-sale.dto';
import { MobilePosLiteService } from './mobile-pos-lite.service';

@Controller('mobile-pos-lite')
export class MobilePosLiteController {
  constructor(private readonly service: MobilePosLiteService) {}

  @Get('terminals')
  @RequirePermissions('mobile_pos_lite.manage')
  findTerminals(@Query() query: QueryMobilePosTerminalDto, @CurrentUser() user: AuthUser) {
    return this.service.findTerminals(query, user);
  }

  @Post('terminals')
  @RequirePermissions('mobile_pos_lite.manage')
  createTerminal(@Body() dto: CreateMobilePosTerminalDto, @CurrentUser() user: AuthUser) {
    return this.service.createTerminal(dto, user);
  }

  @Patch('terminals/:id')
  @RequirePermissions('mobile_pos_lite.manage')
  updateTerminal(
    @Param('id') id: string,
    @Body() dto: UpdateMobilePosTerminalDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.updateTerminal(id, dto, user);
  }

  @Patch('terminals/:id/status')
  @RequirePermissions('mobile_pos_lite.manage')
  updateTerminalStatus(
    @Param('id') id: string,
    @Body() dto: UpdateMobilePosTerminalStatusDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.updateTerminalStatus(id, dto.status, user);
  }

  @Post('terminals/:id/activation')
  @RequirePermissions('mobile_pos_lite.manage')
  issueActivation(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.issueActivation(id, user);
  }

  @Post('activate')
  @RequirePermissions('mobile_pos_lite.use')
  activate(@Body() dto: ActivateMobilePosTerminalDto, @CurrentUser() user: AuthUser) {
    return this.service.activate(dto, user);
  }

  @Get('session')
  @RequirePermissions('mobile_pos_lite.use')
  session(
    @Headers('x-mobile-pos-terminal') terminalCode: string | undefined,
    @Headers('x-mobile-pos-device') deviceSecret: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.session(terminalCode, deviceSecret, user);
  }

  @Get('products')
  @RequirePermissions('mobile_pos_lite.use')
  products(
    @Headers('x-mobile-pos-terminal') terminalCode: string | undefined,
    @Headers('x-mobile-pos-device') deviceSecret: string | undefined,
    @Query() query: QueryMobilePosLiteCatalogDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.products(terminalCode, deviceSecret, query.search, user);
  }

  @Get('catalog')
  @RequirePermissions('mobile_pos_lite.use')
  catalog(
    @Headers('x-mobile-pos-terminal') terminalCode: string | undefined,
    @Headers('x-mobile-pos-device') deviceSecret: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.products(terminalCode, deviceSecret, undefined, user);
  }

  @Get('customers')
  @RequirePermissions('mobile_pos_lite.use')
  customers(
    @Headers('x-mobile-pos-terminal') terminalCode: string | undefined,
    @Headers('x-mobile-pos-device') deviceSecret: string | undefined,
    @Query() query: QueryMobilePosLiteCatalogDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.customers(terminalCode, deviceSecret, query.search, user);
  }

  @Post('sales')
  @RequirePermissions('mobile_pos_lite.use')
  createSale(
    @Headers('x-mobile-pos-terminal') terminalCode: string | undefined,
    @Headers('x-mobile-pos-device') deviceSecret: string | undefined,
    @Body() dto: CreateMobilePosLiteSaleDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.createSale(terminalCode, deviceSecret, dto, user);
  }
}
