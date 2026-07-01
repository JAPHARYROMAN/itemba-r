import { Controller, Get, Post, Put, Delete, Body, Param, Query } from '@nestjs/common';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { ContactPersonsService } from './contact-persons.service';
import { CreateContactPersonDto } from './dto/create-contact-person.dto';
import { UpdateContactPersonDto } from './dto/update-contact-person.dto';
import { QueryContactPersonDto } from './dto/query-contact-person.dto';

@Controller('contact-persons')
export class ContactPersonsController {
  constructor(private readonly service: ContactPersonsService) {}

  @Get()
  @RequirePermissions('contact_persons.list')
  findAll(@Query() query: QueryContactPersonDto, @CurrentUser() user: AuthUser) {
    return this.service.findAll(query, user);
  }

  @Get(':id')
  @RequirePermissions('contact_persons.view')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user);
  }

  @Post()
  @RequirePermissions('contact_persons.create')
  create(@Body() dto: CreateContactPersonDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Put(':id')
  @RequirePermissions('contact_persons.update')
  update(@Param('id') id: string, @Body() dto: UpdateContactPersonDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user);
  }

  @Delete(':id')
  @RequirePermissions('contact_persons.delete')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user);
  }
}
