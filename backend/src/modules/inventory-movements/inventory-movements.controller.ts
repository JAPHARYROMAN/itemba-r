import { Controller, Get, Param, Query } from '@nestjs/common';
import { InventoryMovementsService } from './inventory-movements.service';
import { QueryInventoryMovementDto } from './dto/query-inventory-movement.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@Controller('inventory-movements')
export class InventoryMovementsController {
  constructor(private readonly service: InventoryMovementsService) {}

  @Get()
  @RequirePermissions('inventory.movements.view')
  findAll(@Query() query: QueryInventoryMovementDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get('summary')
  @RequirePermissions('inventory.movements.view')
  summary(@Query() query: QueryInventoryMovementDto, @CurrentUser() user: AuthUser) {
    return this.service.summary(query, user);
  }

  @Get(':id')
  @RequirePermissions('inventory.movements.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }
}
