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
import { SuppliersService } from './suppliers.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { QuerySupplierDto } from './dto/query-supplier.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly service: SuppliersService) {}

  @Get()
  @RequirePermissions('suppliers.view')
  findAll(@Query() query: QuerySupplierDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get('workbench-summary')
  @RequirePermissions('suppliers.view')
  workbenchSummary(@Query() query: QuerySupplierDto, @CurrentUser() user: AuthUser) {
    return this.service.workbenchSummary(query, user);
  }

  @Get(':id/control-center')
  @RequirePermissions('suppliers.view')
  controlCenter(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.controlCenter(id, user);
  }

  @Get(':id/ledger')
  @RequirePermissions('suppliers.view')
  ledger(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.ledger(id, user);
  }

  @Get(':id/purchase-summary')
  @RequirePermissions('suppliers.view')
  purchaseSummary(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.purchaseSummary(id, user);
  }

  @Get(':id/payables-summary')
  @RequirePermissions('suppliers.view')
  payablesSummary(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.payablesSummary(id, user);
  }

  @Get(':id')
  @RequirePermissions('suppliers.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('suppliers.create')
  create(@Body() dto: CreateSupplierDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Patch(':id')
  @RequirePermissions('suppliers.update')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateSupplierDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('suppliers.delete')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }
}
