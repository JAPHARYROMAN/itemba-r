import { Controller, Get, Post, Patch, Delete, Body, Param } from '@nestjs/common';
import { SupportTicketCommentsService } from './support-ticket-comments.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@Controller()
export class SupportTicketCommentsController {
  constructor(private readonly service: SupportTicketCommentsService) {}

  @Post('support/tickets/:id/comments')
  @RequirePermissions('support.tickets.create')
  addComment(@Param('id') ticketId: string, @Body() dto: any, @CurrentUser() user: AuthUser) {
    return this.service.addComment(ticketId, dto, user);
  }

  @Get('support/tickets/:id/comments')
  @RequirePermissions('support.tickets.view')
  getComments(@Param('id') ticketId: string, @CurrentUser() user: AuthUser) {
    return this.service.getComments(ticketId, user);
  }

  @Patch('support/comments/:id')
  @RequirePermissions('support.comments.manage')
  update(@Param('id') id: string, @Body() dto: any, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user.id);
  }

  @Delete('support/comments/:id')
  @RequirePermissions('support.comments.manage')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.id);
  }
}
