import { Module } from '@nestjs/common';
import { ComplianceObligationsModule } from './compliance-obligations/compliance-obligations.module';
import { ComplianceEventsModule } from './compliance-events/compliance-events.module';
import { ComplianceCalendarModule } from './compliance-calendar/compliance-calendar.module';
import { StatutoryDeductionRulesModule } from './statutory-deduction-rules/statutory-deduction-rules.module';
import { ComplianceDocumentRequirementsModule } from './compliance-document-requirements/compliance-document-requirements.module';
import { ComplianceDocumentStatusModule } from './compliance-document-status/compliance-document-status.module';
import { ComplianceDashboardModule } from './compliance-dashboard/compliance-dashboard.module';
import { ComplianceReportsModule } from './compliance-reports/compliance-reports.module';

@Module({
  imports: [
    ComplianceObligationsModule,
    ComplianceEventsModule,
    ComplianceCalendarModule,
    StatutoryDeductionRulesModule,
    ComplianceDocumentRequirementsModule,
    ComplianceDocumentStatusModule,
    ComplianceDashboardModule,
    ComplianceReportsModule,
  ],
  exports: [
    ComplianceObligationsModule,
    ComplianceEventsModule,
    ComplianceCalendarModule,
    StatutoryDeductionRulesModule,
    ComplianceDocumentRequirementsModule,
    ComplianceDocumentStatusModule,
    ComplianceDashboardModule,
    ComplianceReportsModule,
  ],
})
export class ComplianceModule {}
