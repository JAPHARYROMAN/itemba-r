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
import { PayablesService } from './payables.service';
import { CreatePayableDto } from './dto/create-payable.dto';
import { UpdatePayableDto } from './dto/update-payable.dto';
import { QueryPayableDto } from './dto/query-payable.dto';
import { RecordPayablePaymentDto } from './dto/record-payable-payment.dto';
import { WriteOffPayableDto } from './dto/write-off-payable.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@Controller('payables')
export class PayablesController {
  constructor(private readonly service: PayablesService) {}

  @Get()
  @RequirePermissions('payables.view')
  findAll(@Query() query: QueryPayableDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get(':id')
  @RequirePermissions('payables.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('payables.manage')
  create(@Body() dto: CreatePayableDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Patch(':id')
  @RequirePermissions('payables.manage')
  update(@Param('id') id: string, @Body() dto: UpdatePayableDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user);
  }

  @Patch(':id/record-payment')
  @RequirePermissions('payables.manage')
  recordPayment(
    @Param('id') id: string,
    @Body() dto: RecordPayablePaymentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.recordPayment(id, dto, user);
  }

  @Patch(':id/write-off')
  @RequirePermissions('payables.manage')
  writeOff(@Param('id') id: string, @Body() dto: WriteOffPayableDto, @CurrentUser() user: AuthUser) {
    return this.service.writeOff(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('payables.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }
}
