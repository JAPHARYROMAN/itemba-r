import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { IntercompanyTransactionsService } from './intercompany-transactions.service';
import { CreateIntercompanyTransactionDto } from './dto/create-intercompany-transaction.dto';
import { UpdateIntercompanyTransactionDto } from './dto/update-intercompany-transaction.dto';
import { QueryIntercompanyTransactionDto } from './dto/query-intercompany-transaction.dto';
import { RejectIntercompanyTransactionDto } from './dto/reject-intercompany-transaction.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@Controller('intercompany-transactions')
export class IntercompanyTransactionsController {
  constructor(private readonly service: IntercompanyTransactionsService) {}

  @Get()
  @RequirePermissions('intercompany.view')
  findAll(@Query() query: QueryIntercompanyTransactionDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get(':id')
  @RequirePermissions('intercompany.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('intercompany.manage')
  create(@Body() dto: CreateIntercompanyTransactionDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Patch(':id')
  @RequirePermissions('intercompany.manage')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateIntercompanyTransactionDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @Patch(':id/submit')
  @RequirePermissions('intercompany.manage')
  submit(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.submit(id, user);
  }

  @Patch(':id/approve')
  @RequirePermissions('intercompany.approve')
  approve(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.approve(id, user);
  }

  @Patch(':id/reject')
  @RequirePermissions('intercompany.approve')
  reject(
    @Param('id') id: string,
    @Body() dto: RejectIntercompanyTransactionDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.reject(id, dto, user);
  }

  @Patch(':id/post')
  @RequirePermissions('intercompany.post')
  post(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.post(id, user);
  }

  @Delete(':id')
  @RequirePermissions('intercompany.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }
}
