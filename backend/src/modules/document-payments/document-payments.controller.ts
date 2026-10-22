import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { AgentExcluded } from '../../common/decorators/agent-excluded.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { DocumentPaymentsService } from './document-payments.service';
import { ReverseDocumentPaymentDto } from './dto/reverse-document-payment.dto';

@Controller()
export class DocumentPaymentsController {
  constructor(private readonly service: DocumentPaymentsService) {}

  @Get('receivables/:id/payments')
  @AgentExcluded()
  @RequirePermissions('receivables.view')
  receivableHistory(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.list('receivable', id, user);
  }

  @Get('payables/:id/payments')
  @AgentExcluded()
  @RequirePermissions('payables.view')
  payableHistory(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.list('payable', id, user);
  }

  @Patch('receivables/:id/payments/:journalId/reverse')
  @AgentExcluded()
  @RequirePermissions('receivables.manage')
  reverseReceivable(
    @Param('id') id: string,
    @Param('journalId') journalId: string,
    @Body() dto: ReverseDocumentPaymentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.reverseLegacy('receivable', id, journalId, dto, user);
  }

  @Patch('payables/:id/payments/:journalId/reverse')
  @AgentExcluded()
  @RequirePermissions('payables.manage')
  reversePayable(
    @Param('id') id: string,
    @Param('journalId') journalId: string,
    @Body() dto: ReverseDocumentPaymentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.reverseLegacy('payable', id, journalId, dto, user);
  }
}
