import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { DeliveryNotesService } from './delivery-notes.service';
import { CreateDeliveryNoteDto } from './dto/create-delivery-note.dto';
import { UpdateDeliveryNoteDto, DeliverDto } from './dto/update-delivery-note.dto';
import { QueryDeliveryNoteDto } from './dto/query-delivery-note.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@ApiTags('westsides/delivery-notes')
@Controller('westsides/delivery-notes')
export class DeliveryNotesController {
  constructor(private readonly service: DeliveryNotesService) {}

  @Post()
  @RequirePermissions('delivery_notes.create')
  @ApiOperation({ summary: 'Create delivery note with lines' })
  create(@Body() dto: CreateDeliveryNoteDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.id);
  }

  @Get()
  @RequirePermissions('delivery_notes.view')
  @ApiOperation({ summary: 'List delivery notes' })
  findAll(@Query() query: QueryDeliveryNoteDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get(':id')
  @RequirePermissions('delivery_notes.view')
  @ApiOperation({ summary: 'Get delivery note with lines' })
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Patch(':id/dispatch')
  @RequirePermissions('delivery_notes.dispatch')
  @ApiOperation({ summary: 'Dispatch delivery note (DRAFT → DISPATCHED)' })
  dispatch(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.dispatch(id, user.id);
  }

  @Patch(':id/deliver')
  @RequirePermissions('delivery_notes.deliver')
  @ApiOperation({ summary: 'Mark as delivered (DISPATCHED → DELIVERED)' })
  deliver(@Param('id') id: string, @Body() dto: DeliverDto, @CurrentUser() user: AuthUser) {
    return this.service.deliver(id, dto, user.id);
  }

  @Patch(':id/cancel')
  @RequirePermissions('delivery_notes.dispatch')
  @ApiOperation({ summary: 'Cancel delivery note (DRAFT or DISPATCHED → CANCELLED)' })
  cancel(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.cancel(id, user.id);
  }

  @Patch(':id')
  @RequirePermissions('delivery_notes.create')
  @ApiOperation({ summary: 'Update delivery note (DRAFT only)' })
  update(@Param('id') id: string, @Body() dto: UpdateDeliveryNoteDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user.id);
  }

  @Delete(':id')
  @RequirePermissions('delivery_notes.create')
  @ApiOperation({ summary: 'Soft delete delivery note (DRAFT only)' })
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.id);
  }
}
