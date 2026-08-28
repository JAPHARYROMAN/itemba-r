import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { TaxTransactionsQueryDto } from '../../../common/dto/resource-query.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../../common/decorators/current-user.decorator';
import { TaxTransactionsService } from './tax-transactions.service';
import { CreateTaxTransactionDto } from './dto/create-tax-transaction.dto';
import { UpdateTaxTransactionDto } from './dto/update-tax-transaction.dto';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('tax/transactions')
export class TaxTransactionsController {
  constructor(private readonly service: TaxTransactionsService) {}

  @Get()
  @RequirePermissions('tax_transactions.view')
  findAll(@CurrentUser() user: AuthUser, @Query() query: TaxTransactionsQueryDto) {
    return this.service.findAll(user, query);
  }

  @Get(':id')
  @RequirePermissions('tax_transactions.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('tax_transactions.manage')
  create(@Body() dto: CreateTaxTransactionDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Put(':id')
  @RequirePermissions('tax_transactions.manage')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateTaxTransactionDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @Patch(':id/post')
  @RequirePermissions('tax_transactions.manage')
  post(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.post(id, user);
  }

  @Patch(':id/reverse')
  @RequirePermissions('tax_transactions.manage')
  reverse(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.reverse(id, user);
  }

  @Delete(':id')
  @RequirePermissions('tax_transactions.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }
}
